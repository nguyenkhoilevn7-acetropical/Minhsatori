function satoriIsRetired20L_(item) {
  if (!item || typeof item !== 'object') return false;
  if (String(item.code || '').trim() === 'TP-00005') return true;
  var label = [item.name, item.product, item.spec].filter(Boolean).join(' ').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  return /(?:^|[^0-9])20[\s-]*(?:l|lit|litre|liter)\b/.test(label);
}

function satoriGuardRetired20L_(values, previous) {
  var oldOrders = JSON.parse(previous.satori_orders_v15 || '[]');
  var orders = JSON.parse(values.satori_orders_v15 || '[]');
  var identity = function(o) { return String(o.__syncId || o.id) + '|' + String(o.invoiceNo); };
  var oldById = {};
  oldOrders.forEach(function(o) { oldById[identity(o)] = o; });
  JSON.parse(previous.satori_trash_bin_v15 || '[]').forEach(function(t) {
    if (t && t.order && !oldById[identity(t.order)]) oldById[identity(t.order)] = t.order;
  });
  var quantity = function(o) { return (o.items && o.items.length ? o.items : [o]).filter(satoriIsRetired20L_).reduce(function(sum, i) { return sum + Number(i.qty || 0); }, 0); };
  orders.forEach(function(o) {
    var old = oldById[identity(o)];
    if (quantity(o) > (old ? quantity(old) : 0)) throw Error('PRODUCT_DISCONTINUED: Sản phẩm bình 20L đã ngừng bán');
  });
  if (typeof values.satori_catalogue_v15 === 'string') {
    var catalogue = JSON.parse(values.satori_catalogue_v15);
    var active = catalogue.filter(function(i) { return !satoriIsRetired20L_(i); });
    if (active.length !== catalogue.length) values.satori_catalogue_v15 = JSON.stringify(active);
  }
  return values;
}

function satoriRetire20LPreflight() {
  requireOwner_();
  var state = readState_();
  var catalogue = JSON.parse(state.values.satori_catalogue_v15);
  var summary = {revision: state.revision, orders: JSON.parse(state.values.satori_orders_v15).length, active: catalogue.length, retiredCandidates: catalogue.filter(satoriIsRetired20L_).map(function(i) { return i.code; })};
  console.log(JSON.stringify(summary));
  return summary;
}

function satoriRetire20LApply() {
  requireOwner_();
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var state = readState_();
    var catalogue = JSON.parse(state.values.satori_catalogue_v15);
    var retired = catalogue.filter(satoriIsRetired20L_);
    if (!retired.length) return satoriRetire20LPreflight();
    if (retired.length !== 1 || retired[0].code !== 'TP-00005') throw Error('Unexpected retirement candidates');
    var active = catalogue.filter(function(i) { return !satoriIsRetired20L_(i); });
    ['TP-00033', 'TP-00096'].forEach(function(code) {
      if (active.filter(function(i) { return i.code === code; }).length !== 1) throw Error('Missing protected 19L product');
    });
    var file = DriveApp.getFileById(PropertiesService.getScriptProperties().getProperty('STATE_FILE_ID'));
    var before = JSON.stringify(state);
    var backup = file.makeCopy('MinhSatori_PRE_RETIRE20L_rev' + state.revision + '_' + new Date().toISOString());
    if (JSON.stringify(JSON.parse(backup.getBlob().getDataAsString())) !== before) throw Error('Backup verification failed');
    if (JSON.stringify(readState_()) !== before) throw Error('Revision changed before write');
    var next = JSON.parse(before);
    var key = 'satori_retired_catalogue_v15';
    var archive = JSON.parse(next.values[key] || '[]');
    if (archive.some(function(i) { return i.code === 'TP-00005'; })) throw Error('Retired archive already contains product');
    archive.push(Object.assign({}, retired[0], {active: false, retiredAt: new Date().toISOString(), reason: 'Company discontinued 20L sales'}));
    next.values[key] = JSON.stringify(archive);
    next.values.satori_catalogue_v15 = JSON.stringify(active);
    next.revision = state.revision + 1;
    next.updatedAt = new Date().toISOString();
    file.setContent(JSON.stringify(next));
    var checked = readState_();
    if (JSON.stringify(checked) !== JSON.stringify(next)) throw Error('Readback verification failed');
    Object.keys(state.values).forEach(function(k) {
      if (k !== key && k !== 'satori_catalogue_v15' && checked.values[k] !== state.values[k]) throw Error('Unrelated data changed: ' + k);
    });
    var result = {revision: checked.revision, active: active.length, retired: retired.map(function(i) { return i.code; }), orders: JSON.parse(checked.values.satori_orders_v15).length, ordersUnchanged: checked.values.satori_orders_v15 === state.values.satori_orders_v15, backupId: backup.getId()};
    console.log(JSON.stringify(result));
    return result;
  } finally { lock.releaseLock(); }
}
