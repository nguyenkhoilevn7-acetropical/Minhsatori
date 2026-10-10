#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
HỆ THỐNG TRỢ LÝ AI BÓC TÁCH ĐƠN HÀNG ZALO & ĐỒNG BỘ GOOGLE SHEETS
Dành riêng cho Hộ Kinh Doanh Minh Satori
"""

import re
import json
from typing import Dict, Any

# Ưu tiên các tên công ty và quán cụ thể trước, sau đó mới tới chi nhánh
KNOWN_CUSTOMERS = [
    ("HỘ KINH DOANH DỊCH VỤ TÀI LỘC", ["tài lộc", "tai loc", "dịch vụ tài lộc"]),
    ("Công Ty CP ACE Clubhouse", ["ace clubhouse", "ace"]),
    ("CÔNG TY TNHH TM DV THỂ THAO BANGER PICKLEBALL", ["banger pickleball", "pickleball", "banger"]),
    ("Nguyễn Bảo Châu Diamon", ["bảo châu", "bao chau", "nguyễn bảo châu"]),
    ("CÔNG TY CP THƯƠNG MẠI DV VINAHASA (Ốc Q)", ["vinahasa", "ốc q", "oc q"]),
    ("PWC", ["pwc"]),
    ("Mr Ốc Ngon", ["mr ốc ngon", "ốc ngon", "oc ngon"]),
    ("Ốc Lá", ["ốc lá", "oc la"]),
    ("18+", ["18+"]),
    ("Cô Hoa", ["cô hoa", "co hoa"]),
    ("Barber Shop Vũ Trí", ["vũ trí", "vu tri"]),
    ("Nha Khoa Peace", ["peace", "nha khoa peace"]),
    ("Nhà Hàng Thạnh Phú", ["nhà hàng thạnh phú", "thạnh phú", "thanh phu"]),
    ("Hà Minh Nguyệt", ["hà minh nguyệt", "ha minh nguyet", "nguyệt"]),
    ("Edric Salon", ["edric salon", "edric"]),
    # Các chi nhánh Traky
    ("Traky Cần Thơ", ["traky cần thơ", "traky can tho"]),
    ("Traky Rạch Giá", ["traky rạch giá", "traky rach gia"]),
    ("Traky Long Xuyên", ["traky long xuyên", "traky long xuyen"]),
    ("Traky Mỹ Tho", ["traky mỹ tho", "traky my tho"]),
    ("Traky Sóc Trăng", ["traky sóc trăng", "traky soc trang"]),
    ("Traky Bến Tre", ["traky bến tre", "traky ben tre"]),
    ("Traky Bạc Liêu", ["traky bạc liêu", "traky bac lieu"]),
    ("Traky Cà Mau", ["traky cà mau", "traky ca mau"]),
    ("Traky Bình Dương", ["traky bình dương", "traky binh duong"]),
    ("Traky Biên Hòa", ["traky biên hòa", "traky bien hoa"]),
    ("Traky Đà Nẵng 2", ["traky đà nẵng", "traky da nang"]),
    ("Traky Sài Gòn", ["traky sài gòn", "traky sai gon", "traky hair", "traky"])
]

STOP_WORDS = {'nhé', 'nha', 'xuất', 'cho', 'gọi', 'gặp', 'alo', 'sdt', 'sđt', 'thùng', 'két', 'bình', 'chai', 'qua'}

def parse_zalo_message(text: str) -> Dict[str, Any]:
    raw = text.strip()
    t_lower = raw.lower()
    
    # 1. Nhận diện tên khách hàng
    matched_customer = ""
    for full_name, aliases in KNOWN_CUSTOMERS:
        for a in aliases:
            if a in t_lower:
                matched_customer = full_name
                break
        if matched_customer:
            break
            
    if not matched_customer:
        parts = [p.strip() for p in re.split(r'[,;\n]', raw) if p.strip()]
        if parts and len(parts[0]) <= 35:
            matched_customer = parts[0]
        else:
            matched_customer = "Khách Hàng Mới"

    # 2. Nhận diện số điện thoại & người nhận
    phone_val = ""
    phone_match = re.search(r'(0\d{9,10}|\+84\d{9,10})', raw)
    if phone_match:
        phone_val = phone_match.group(1)
        # Tìm tên người liên hệ
        contact_match = re.search(re.escape(phone_val) + r'\s*\(?\s*([A-ZÀ-Ỹa-zà-ỹ]+)\s*\)?', raw, re.IGNORECASE)
        if contact_match and contact_match.group(1).lower() not in STOP_WORDS:
            phone_val += f" ({contact_match.group(1).capitalize()})"
        else:
            before_match = re.search(r'(?:gọi|gặp|anh|chị|a|c)?\s*([A-ZÀ-Ỹa-zà-ỹ]+)\s*[-:]?\s*' + re.escape(phone_val), raw, re.IGNORECASE)
            if before_match and before_match.group(1).lower() not in STOP_WORDS:
                phone_val += f" ({before_match.group(1).capitalize()})"

    # 3. Nhận diện số lượng
    qty = 10
    qty_match = re.search(r'(\d+)\s*(?:thùng|thung|két|ket|bình|binh|chai|lốc|loc)', raw, re.IGNORECASE) or \
                re.search(r'(?:lấy|giao|đặt|cho)\s*(\d+)', raw, re.IGNORECASE)
    if qty_match:
        qty = int(qty_match.group(1))

    # 4. Nhận diện quy cách sản phẩm
    product = "Suối Satori 350ml"
    list_price = 88000
    discount = 23000
    unit_price = 65000

    if any(k in t_lower for k in ["500ml", "550ml", "500"]):
        product = "Suối Satori 500ml"
        list_price = 88000
        discount = 18000
        unit_price = 70000
    elif any(k in t_lower for k in ["1.5l", "1500ml"]):
        product = "Suối Satori 1.5L"
        list_price = 88000
        discount = 24300
        unit_price = 63700
    elif any(k in t_lower for k in ["5l"]):
        product = "Suối Satori 5L"
        list_price = 88000
        discount = 24300
        unit_price = 63700
    elif any(k in t_lower for k in ["19l", "20l", "bình lớn"]):
        product = "Bình Satori 19L"
        list_price = 65000
        discount = 10000
        unit_price = 55000
    elif any(k in t_lower for k in ["ổi", "mãng cầu", "me", "trái cây"]):
        product = "Nước Trái Cây & Suối Satori"
        list_price = 250000
        discount = 33334
        unit_price = 216666

    # 5. Tách địa chỉ giao hàng
    location = ""
    addr_match = re.search(r'(?:qua|tại|địa chỉ|đc:?)\s*([0-9A-ZÀ-Ỹa-zà-ỹ\s,.-]+?)(?:(?:\b(?:sđt|sdt|gọi|lấy|thùng|đã ck|nha|nhé)\b)|$)', raw, re.IGNORECASE)
    if addr_match and len(addr_match.group(1).strip()) > 8:
        location = addr_match.group(1).strip().strip(' ,.-:')
    else:
        for part in re.split(r'[,;\n]', raw):
            part_str = part.strip()
            if re.search(r'\d+', part_str) and re.search(r'đường|phố|nguyễn|lê|trần|quận|q\.|p\.|hcm|hà nội|thủ đức|bạch đằng', part_str, re.IGNORECASE):
                location = part_str
                break

    # 6. Trạng thái thanh toán & VAT
    is_paid = bool(re.search(r'đã ck|ck rồi|đã chuyển|đã thanh toán|paid|đã trả', t_lower))
    has_vat = bool(re.search(r'vat|hóa đơn đỏ|8%', t_lower))

    subtotal = qty * unit_price
    vat_amount = round(subtotal * 0.08) if has_vat else 0
    total = subtotal + vat_amount

    return {
        "name": matched_customer,
        "phone": phone_val,
        "location": location,
        "product": product,
        "qty": qty,
        "list_price": list_price,
        "discount": discount,
        "unit_price": unit_price,
        "subtotal": subtotal,
        "vat": "yes" if has_vat else "no",
        "vat_amount": vat_amount,
        "total": total,
        "status": "Đã thanh toán" if is_paid else "Chưa thanh toán"
    }

if __name__ == "__main__":
    test_messages = [
        "Traky Sài Gòn, 377 Nguyễn Duy Trinh Q.2, 15 thùng 350ml, 0379034849 (Trọng)",
        "Giao giúp e qua 189 Chùa Láng Hà Nội 10 thùng satori 350ml cho Edric Salon nha sdt 0964367032",
        "Thạnh Phú lấy 10 thùng 500ml nha e, địa chỉ 52 bình phú tam bình thủ đức, gọi Hằng 0784723916 nhé, đã ck",
        "Cho 20 thùng suối qua 234 Bạch Đằng Đà Nẵng, bên cty Tài Lộc, gọi 0763122658 xuất vat 8% luôn nha"
    ]
    
    print("=" * 60)
    print("KIỂM TRA TRỢ LÝ AI BÓC TÁCH ĐƠN HÀNG ZALO:")
    print("=" * 60)
    for msg in test_messages:
        print(f"\n[Tin nhắn gốc]: {msg}")
        result = parse_zalo_message(msg)
        print(f"-> Khách: {result['name']} | SĐT: {result['phone']}")
        print(f"-> Đ/c: {result['location']} | Hàng: {result['qty']} thùng {result['product']}")
        print(f"-> Tổng tiền: {result['total']:,} đ | Thanh toán: {result['status']} | VAT: {result['vat']}")
