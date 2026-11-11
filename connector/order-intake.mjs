/**
 * Shared text / voice-transcript Order Intake for the existing Minh Satori
 * canonical invoice flow. This module prepares a strict orders.create payload;
 * it does not call the API, write a ledger, or submit without owner approval.
 *
 * The LLM is responsible only for extracting candidate fields from transcript.
 * This module performs deterministic validation, catalogue/profile binding,
 * tax calculation, idempotency validation and payload construction.
 */
const norm = value => String(value ?? '')
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .replace(/đ/g, 'd').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

const validRequestId = value =>
  typeof value === 'string' && /^[a-zA-Z0-9_-]{8,100}$/.test(value);

const validRate = value =>
  typeof value === 'number' && Number.isFinite(value) &&
  value >= 0 && value <= 100 &&
  Math.abs(value * 100 - Math.round(value * 100)) < 1e-7;

const roundMoney = value => {
  if (!Number.isSafeInteger(value) || value < 0 || value > 1e11) {
    throw new RangeError('Invalid VND amount');
  }
  return value;
};

function issue(code, field, message) {
  return {code, field, message};
}

/**
 * @param {{
 *  source: 'text'|'voice_transcript',
 *  transcript: string,
 *  extracted: object,
 *  customerProfile?: object|null,
 *  catalogue?: object[],
 *  expectedRevision: number,
 *  requestId: string,
 *  confirmNewCustomer?: boolean
 * }} input
 * @returns {{status:string,issues:object[],draft?:object,toolCall?:object,source:string}}
 */
export function prepareOrderIntake(input = {}) {
  const source = input.source;
  const issues = [];
  if (!['text', 'voice_transcript'].includes(source)) {
    issues.push(issue('INVALID_SOURCE', 'source', 'Nguồn phải là text hoặc voice_transcript.'));
  }
  if (typeof input.transcript !== 'string' || !input.transcript.trim()) {
    issues.push(issue('TRANSCRIPT_REQUIRED', 'transcript', 'Thiếu nội dung tin nhắn hoặc voice transcript.'));
  }
  if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0) {
    issues.push(issue('REVISION_REQUIRED', 'expectedRevision', 'Cần revision mới nhất từ sổ hóa đơn.'));
  }
  if (!validRequestId(input.requestId)) {
    issues.push(issue('REQUEST_ID_REQUIRED', 'requestId', 'Cần requestId ổn định để chống tạo trùng.'));
  }
  const x = input.extracted;
  if (!x || typeof x !== 'object' || Array.isArray(x)) {
    issues.push(issue('EXTRACTION_REQUIRED', 'extracted', 'Chưa có dữ liệu order có cấu trúc từ AI.'));
    return {status:'NEEDS_CONFIRMATION', source, issues};
  }

  const customer = x.customer && typeof x.customer === 'object' ? x.customer : {};
  const name = String(customer.name ?? '').trim();
  let phone = String(customer.phone ?? '').trim();
  const address = String(customer.address ?? '').trim();
  if (name.length < 2) issues.push(issue('CUSTOMER_NAME_REQUIRED', 'customer.name', 'Chưa xác định rõ tên khách/người nhận.'));
  if (address.length < 5) issues.push(issue('ADDRESS_REQUIRED', 'customer.address', 'Chưa có địa chỉ giao hàng hợp lệ.'));

  const profile = input.customerProfile || null;
  let customerRef;
  let confirmedNewCustomer = false;
  if (profile) {
    const profilePhone = String(profile.phone ?? '').trim();
    const phoneMatches = !profilePhone || !phone ||
      profilePhone.replace(/\D/g,'') === phone.replace(/\D/g,'');
    const exact = norm(profile.name) === norm(name) &&
      norm(profile.address) === norm(address) && phoneMatches;
    if (!phone && profilePhone) phone = profilePhone;
    if (!exact) {
      issues.push(issue('CUSTOMER_PROFILE_MISMATCH', 'customer', 'Thông tin không khớp chính xác hồ sơ/điểm giao đã chọn.'));
    } else if (profile.id == null || !Number.isSafeInteger(Number(profile.invoiceNo)) || Number(profile.invoiceNo) <= 0) {
      issues.push(issue('CUSTOMER_REFERENCE_REQUIRED', 'customerProfile', 'Hồ sơ khách thiếu ID hoặc số hóa đơn tham chiếu.'));
    } else {
      customerRef = {id: profile.id, invoiceNo: Number(profile.invoiceNo)};
    }
  } else if (input.confirmNewCustomer === true) {
    confirmedNewCustomer = true;
  } else {
    issues.push(issue('CUSTOMER_SELECTION_REQUIRED', 'customer', 'Cần chọn đúng hồ sơ/điểm giao hoặc xác nhận đây là khách mới.'));
  }

  if (!Array.isArray(x.items) || x.items.length === 0 || x.items.length > 50) {
    issues.push(issue('ITEMS_REQUIRED', 'items', 'Cần ít nhất một dòng sản phẩm, tối đa 50 dòng.'));
    return {status:'NEEDS_CONFIRMATION', source, issues};
  }

  const catalogue = Array.isArray(input.catalogue) ? input.catalogue : [];
  const items = [];
  for (let index = 0; index < x.items.length; index++) {
    const raw = x.items[index] || {};
    const field = 'items[' + index + ']';
    const qty = raw.qty;
    if (!Number.isSafeInteger(qty) || qty <= 0 || qty > 100000) {
      issues.push(issue('QUANTITY_REQUIRED', field + '.qty', 'Số lượng phải là số nguyên dương.'));
      continue;
    }

    let product;
    let unitPrice;
    let listPrice;
    let unit;
    let code = '';
    const isManual = raw.manualEntry === true;
    if (isManual) {
      const productName = String(raw.product ?? '').trim();
      if (productName.length < 2) {
        issues.push(issue('PRODUCT_REQUIRED', field + '.product', 'Dòng thêm thủ công thiếu tên sản phẩm.'));
        continue;
      }
      if (!Number.isSafeInteger(raw.unitPrice) || raw.unitPrice < 0) {
        issues.push(issue('PRICE_REQUIRED', field + '.unitPrice', 'Dòng thêm thủ công cần đơn giá xác nhận.'));
        continue;
      }
      product = productName;
      unitPrice = raw.unitPrice;
      listPrice = Number.isSafeInteger(raw.listPrice) && raw.listPrice >= unitPrice ? raw.listPrice : unitPrice;
      unit = String(raw.unit || '').trim();
      if (!unit) {
        issues.push(issue('UNIT_REQUIRED', field + '.unit', 'Dòng thêm thủ công cần đơn vị tính.'));
        continue;
      }
    } else {
      const query = norm(raw.product);
      const matches = catalogue.filter(p =>
        (raw.code && String(p.code || '') === String(raw.code)) ||
        (query && norm(p.name || p.product) === query)
      );
      if (matches.length !== 1) {
        issues.push(issue(matches.length ? 'PRODUCT_AMBIGUOUS' : 'PRODUCT_NOT_FOUND',
          field + '.product', matches.length
            ? 'Có nhiều sản phẩm phù hợp; cần chọn đúng mã hàng.'
            : 'Không tìm thấy sản phẩm khớp chính xác trong danh mục.'));
        continue;
      }
      const p = matches[0];
      product = String(p.name || p.product || '').trim();
      unit = String(p.unit || '').trim();
      code = String(p.code || '');
      unitPrice = p.unitPrice;
      listPrice = p.listPrice == null ? unitPrice : p.listPrice;
      if (!Number.isSafeInteger(unitPrice) || unitPrice < 0 ||
          !Number.isSafeInteger(listPrice) || listPrice < unitPrice || !unit) {
        issues.push(issue('CATALOGUE_PRICE_INVALID', field + '.product', 'Danh mục thiếu đơn giá/đơn vị hợp lệ.'));
        continue;
      }
      if (raw.unit && norm(raw.unit) !== norm(unit)) {
        issues.push(issue('UNIT_MISMATCH', field + '.unit', 'Đơn vị khách yêu cầu khác đơn vị danh mục; cần xác nhận quy đổi.'));
        continue;
      }
    }

    // Explicit line tax always wins. Manual-entry rows default to exempt (0%).
    // Catalogue rows inherit the selected customer's tax profile, never a global rate.
    let vatRate;
    if (raw.taxChoiceExplicit === true) {
      if (!validRate(raw.vatRate)) {
        issues.push(issue('TAX_RATE_INVALID', field + '.vatRate', 'Mức thuế riêng phải từ 0 đến 100%, tối đa 2 chữ số thập phân.'));
        continue;
      }
      vatRate = raw.vatRate;
    } else if (profile && validRate(profile.defaultVatRate)) {
      // Every new row, including manual entries, inherits the selected customer's
      // current profile rate. An explicit line-level choice (e.g. deposit 0%)
      // overrides this default without changing any other row.
      vatRate = profile.defaultVatRate;
    } else {
      issues.push(issue('TAX_PROFILE_REQUIRED', field + '.vatRate', 'Chưa xác định mức thuế mặc định từ hồ sơ khách hàng; không tự gán 8% hoặc 0%.'));
      continue;
    }

    const subtotal = roundMoney(qty * unitPrice);
    const vatAmount = Math.round(subtotal * vatRate / 100);
    items.push({
      product, code, qty, unit, unitPrice, listPrice,
      vatRate, vatAmount
    });
  }

  const shippingAmount = x.shippingAmount == null ? 0 : x.shippingAmount;
  if (!Number.isSafeInteger(shippingAmount) || shippingAmount < 0 || shippingAmount > 1e11) {
    issues.push(issue('SHIPPING_INVALID', 'shippingAmount', 'Phí giao hàng không hợp lệ.'));
  }
  if (issues.length) return {status:'NEEDS_CONFIRMATION', source, issues};

  const goodsTotal = items.reduce((sum, item) => sum + item.qty * item.unitPrice, 0);
  const vatAmount = items.reduce((sum, item) => sum + item.vatAmount, 0);
  const total = roundMoney(goodsTotal + shippingAmount + vatAmount);
  const order = {
    name, phone, location: address, items,
    shippingAmount, vatAmount, total,
    deliveryNote: String(x.deliveryNote || '').trim().slice(0, 1000),
    deliveryDate: String(x.deliveryDate || '').trim() || null
  };
  const payload = {
    expectedRevision: input.expectedRevision,
    requestId: input.requestId,
    order
  };
  if (customerRef) payload.customerRef = customerRef;
  if (confirmedNewCustomer) payload.confirmedNewCustomer = true;

  return {
    status:'READY_FOR_OWNER_CONFIRMATION',
    source,
    transcript: input.transcript.trim(),
    issues:[],
    draft: {customer:{name,phone,address},items,goodsTotal,shippingAmount,vatAmount,total},
    toolCall: {name:'satori_orders_create',payload}
  };
}

/** Invoke only after an authenticated owner approval outside the model payload. */
export async function submitPreparedOrder({prepared, executeCanonicalTool, ownerApproved}) {
  if (!prepared || prepared.status !== 'READY_FOR_OWNER_CONFIRMATION' || !prepared.toolCall) {
    throw new Error('Order is not ready for submission');
  }
  if (ownerApproved !== true) throw new Error('Owner confirmation is required');
  if (typeof executeCanonicalTool !== 'function') throw new Error('Canonical order tool is unavailable');
  return executeCanonicalTool(prepared.toolCall.name, prepared.toolCall.payload);
}
