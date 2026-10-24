"""Production cart browser regressions. Every API response is fake; no live writes.

Run: pip install playwright && playwright install chromium
     python customer-ai-chat-prototype/tests/production-cart-browser.py
Optional: CHROMIUM_EXECUTABLE=/usr/bin/chromium, CART_SCREENSHOTS=/tmp/cart-shots
"""
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile
import threading
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse

from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[2]
APP = ROOT / "customer-ai-chat-prototype"
TOKEN = "T" * 96
ORDER_KEY = "satori-order:" + TOKEN[:32]
SUBMITTED_KEY = "satori-submitted:" + TOKEN[:32]
PENDING_KEY = "satori-pending:" + TOKEN[:32]
CUSTOMER = {"name": "KH KIỂM THỬ", "phone": "0000000000", "location": "Địa chỉ giả lập"}
PRODUCTS = [
    {"code": "TEST-WATER", "name": "Satori nước tinh khiết chai nhỏ", "unit": "thùng", "unitPrice": 100000},
    {"code": "TEST-GUAVA", "name": "Juice ổi hồng chai gia đình", "unit": "thùng", "unitPrice": 200000},
    {"code": "TEST-APPLE", "name": "Juice táo nguyên chất chai nhỏ", "unit": "thùng", "unitPrice": 200000},
    {"code": "TEST-MANGO", "name": "Juice mãng cầu chai nước trái cây", "unit": "thùng", "unitPrice": 200000},
    {"code": "TEST-HIKARI", "name": "Hikari nước điện giải đóng thùng", "unit": "thùng", "unitPrice": 200000},
    {"code": "TEST-LARGE", "name": "Satori nước tinh khiết bình gia đình lớn", "unit": "bình", "unitPrice": 100000},
]
OLD_INVOICE = {
    "invoiceNo": 7001, "total": 100000, "date": "24/10/2026",
    "createdAt": "2026-10-24T01:00:00.000Z", "paid": False, **CUSTOMER,
    "items": [{"product": PRODUCTS[0]["name"], "qty": 1, "unit": "thùng", "unitPrice": 100000}],
    "receiptToken": "fake-receipt-old",
}


class FakeAPI:
    def __init__(self, html, origin, uncertain=False):
        self.html, self.origin, self.uncertain = html, origin, uncertain
        self.calls, self.quotes, self.saved = [], {}, {}
        self.unexpected = []
        self.defer_confirm = False
        self.pending_confirm = None

    def route(self, route):
        req = route.request
        parsed = urlparse(req.url)
        if f"{parsed.scheme}://{parsed.netloc}" != self.origin:
            self.unexpected.append(req.url)
            route.abort()
            return
        path = parsed.path
        if path == "/":
            route.fulfill(status=200, content_type="text/html", body=self.html)
            return
        if path.startswith("/assets/") or path == "/favicon.ico":
            route.fulfill(status=204, body="")
            return
        if not path.startswith("/api/real/"):
            self.unexpected.append(req.url)
            route.abort()
            return
        body = req.post_data_json
        assert req.method == "POST", req.method
        assert body["token"] == TOKEN and body["accessCode"] == "test-pin"
        self.calls.append((path, body))
        response = {"ok": True}
        if path == "/api/real/catalogue":
            response.update(customer=CUSTOMER, products=PRODUCTS, discountPercent=0)
        elif path == "/api/real/history":
            response.update(orders=[OLD_INVOICE, *self.saved.values()], revision=1, complete=True)
        elif path == "/api/real/interpret":
            qty = int(re.search(r"\d+", body["message"])[0])
            rows = [{"code": p["code"], "qty": i + 1} for i, p in enumerate(PRODUCTS)] if body["message"].startswith("6 loại") else [{"code": PRODUCTS[0]["code"], "qty": qty}]
            response.update(cart=rows, message="Đã cập nhật giỏ giả lập.")
        elif path == "/api/real/quote":
            qt = f"fake-quote-{len(self.quotes) + 1}"
            items = [dict(product=next(p["name"] for p in PRODUCTS if p["code"] == row["code"]),
                          qty=row["qty"], unit="thùng", unitPrice=100000) for row in body["items"]]
            total = sum(i["qty"] * i["unitPrice"] for i in items)
            response.update(quoteToken=qt, customer=CUSTOMER, items=items, subtotal=total,
                            shippingAmount=0, vatAmount=0, total=total, deliveryNote=body.get("deliveryNote", ""))
            self.quotes[qt] = {**response, "clientOrderId": body["clientOrderId"]}
        elif path == "/api/real/confirm":
            if self.defer_confirm:
                self.pending_confirm = route
                return
            if self.uncertain:
                route.fulfill(status=504, json={"ok": False, "message": "Mất phản hồi giả lập"})
                return
            assert body["confirmation"] == "CUSTOMER_CONFIRMS_REAL_ORDER"
            q = self.quotes[body["quoteToken"]]
            oid = q["clientOrderId"]
            if oid not in self.saved:
                no = 7002 + len(self.saved)
                self.saved[oid] = {**OLD_INVOICE, **q, "invoiceNo": no, "receiptToken": f"fake-receipt-{no}"}
            invoice = self.saved[oid]
            response.update(saved=True, invoiceNo=invoice["invoiceNo"], total=invoice["total"],
                            receiptToken=invoice["receiptToken"], createdAt=invoice["createdAt"])
        else:
            self.unexpected.append(path)
            route.abort()
            return
        route.fulfill(status=200, json=response)

    def count(self, endpoint):
        return sum(path == "/api/real/" + endpoint for path, _ in self.calls)


def order_id(page):
    return page.evaluate("key => sessionStorage.getItem(key)", ORDER_KEY)


def login(page):
    page.locator("#realCode").fill("test-pin")
    page.locator("#realOpen").click()
    expect(page.locator("#productionGeminiApp")).to_be_visible()
    expect(page.locator("#messageInput")).to_be_enabled()


def send(page, text="3 thùng nước"):
    page.locator("#messageInput").fill(text)
    page.locator("#sendForm button[type=submit]").click()
    expect(page.locator("#messages .bubble.assistant").last).to_have_text("Đã cập nhật giỏ giả lập.")
    expect(page.locator("#quickCart")).to_be_visible()


def swipe(page, direction):
    handle = page.locator("#realCartHandle").bounding_box()
    assert handle
    x, y = handle["x"] + handle["width"] / 2, handle["y"] + handle["height"] / 2
    page.mouse.move(x, y)
    page.mouse.down()
    page.mouse.move(x, y + (82 if direction == "down" else -82), steps=8)
    page.mouse.up()


def settle_cart(page):
    # Await compositor transitions rather than comparing moving rectangles.
    page.locator("#quickCart").evaluate("""async e => {
      getComputedStyle(e).transform;
      await Promise.all(e.getAnimations().map(a => a.finished.catch(() => {})));
    }""")


def collapsed_geometry(page):
    settle_cart(page)
    expect(page.locator("#quickCart")).to_have_attribute("data-cart-mode", "collapsed")
    expect(page.locator(".real-cart-direction")).to_have_text("⌃")
    expect(page.locator("#quickCartQuote")).not_to_be_visible()
    expect(page.locator("#realCartClose")).not_to_be_visible()
    expect(page.locator("#inlineCartLines")).not_to_be_visible()
    bounds = page.evaluate("""() => {
      const box = s => {const r=document.querySelector(s).getBoundingClientRect();return {x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height}};
      return {cart:box('#quickCart'),send:box('#sendForm button[type=submit]'),input:box('#messageInput'),icon:box('.real-cart-icon'),badge:box('.real-cart-count'),viewport:innerWidth};
    }""")
    c, s, i, b = (bounds[k] for k in ["cart", "send", "icon", "badge"])
    assert c["width"] <= 80, bounds
    assert c["bottom"] <= s["y"] + 1, bounds
    assert 0 <= bounds["viewport"] - c["right"] <= 9, bounds
    assert c["bottom"] <= bounds["input"]["y"] + 1, bounds
    assert b["right"] <= i["x"] + 1, "Quantity must appear BEFORE the basket icon"
    assert i["right"] <= c["right"] + 1, bounds
    assert 0 <= c["x"] < c["right"] <= bounds["viewport"], bounds
    arrow = page.locator("#realCartHandle").bounding_box()
    assert arrow and arrow["y"] + arrow["height"] <= i["y"] + 2, "Arrow goes ABOVE the basket"
    no_blue = page.locator("#quickCartEdit").evaluate(
        "e => getComputedStyle(e).backgroundColor in ['rgba(0, 0, 0, 0)', 'transparent']")
    assert no_blue, "Collapsed cart must have no blue button background"


def expanded_geometry(page):
    settle_cart(page)
    expect(page.locator("#quickCart")).to_have_attribute("data-cart-mode", "full")
    expect(page.locator("#quickCartQuote")).to_be_visible()
    expect(page.locator("#quickCartQuote")).to_have_text("Xác Nhận")
    expect(page.locator("#quickCartQuote")).to_be_enabled()
    expect(page.locator("#inlineCartLines .inline-cart-row")).to_have_count(1)
    expect(page.locator(".delivery-note")).to_be_visible()
    boxes = [page.locator(sel).bounding_box() for sel in ["#quickCartQuote", "#quickCartEdit", "#realCartClose"]]
    assert all(boxes)
    for a, b in zip(boxes, boxes[1:]):
        assert a["x"] + a["width"] <= b["x"] + 1, boxes
        assert abs(a["y"] - b["y"]) <= 2, boxes
    cart = page.locator("#quickCart").bounding_box()
    confirm = boxes[0]
    assert cart["y"] <= confirm["y"] and confirm["y"] + confirm["height"] <= cart["y"] + cart["height"] + 1
    assert page.evaluate("document.documentElement.scrollWidth <= innerWidth"), "Horizontal overflow"


def create_quote(page, api):
    page.locator("#quickCartEdit").click()
    page.locator(".delivery-note").fill("Giao trước 14 giờ — dữ liệu giả")
    page.locator("#quickCartQuote").click()
    expect(page.locator(".live-real-confirm").last).to_be_enabled()
    assert api.count("confirm") == 0
    assert api.count("quote") == 1


def success_case(browser, origin, html, viewport, ua, label):
    context = browser.new_context(viewport=viewport, user_agent=ua, is_mobile=True, has_touch=True)
    api = FakeAPI(html, origin)
    context.route("**/*", api.route)
    page = context.new_page()
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.goto(origin + "/#" + TOKEN)
    login(page)
    first_id = order_id(page)
    send(page)
    collapsed_geometry(page)
    swipe(page, "up")
    expanded_geometry(page)
    # Scrolling products must not hide the checkout action.
    page.locator("#inlineCartLines").evaluate("e => e.scrollTop=e.scrollHeight")
    expect(page.locator("#quickCartQuote")).to_be_in_viewport()
    swipe(page, "down")
    collapsed_geometry(page)
    page.locator("#quickCartEdit").click()
    page.locator("#realCartClose").click()
    collapsed_geometry(page)
    page.locator("#quickCartEdit").click()
    # A noninteractive chat bubble closes the cart without clearing items.
    page.locator("#messages .bubble.assistant").last.dispatch_event("click")
    collapsed_geometry(page)
    create_quote(page, api)
    page.evaluate("window.oldConfirm=document.querySelector('.live-real-confirm')")
    # Two programmatic clicks in the same task exercise the synchronous send lock.
    page.evaluate("() => {oldConfirm.click();oldConfirm.click()}")
    expect(page.locator("#messageInput")).to_be_enabled()
    expect(page.locator("#sendForm button[type=submit]")).to_be_enabled()
    expect(page.locator(".real-submitted-card")).to_be_visible()
    actions = page.locator(".real-submitted-card .real-submitted-actions button")
    expect(actions).to_have_count(2)
    assert all((actions.nth(i).bounding_box() or {}).get("height", 999) <= 43 for i in range(2)), "Success actions should be compact"
    assert api.count("confirm") == 1 and len(api.saved) == 1
    page.locator("#closeInvoice").click()
    # An explicit NEW chat message after an acknowledged invoice opens a NEW
    # draft, but never confirms another invoice.
    first_confirm_count = api.count("confirm")
    page.locator("#messageInput").fill("2 thùng nước")
    page.locator("#sendForm button[type=submit]").click()
    expect(page.locator("#messages .bubble.assistant").last).to_have_text("Đã cập nhật giỏ giả lập.")
    assert api.count("confirm") == first_confirm_count
    assert order_id(page) != first_id
    # Repeated locked catalogue and checkout events must produce at most one notice.
    page.locator("#catalogLaunch").click()
    for _ in range(6):
        page.locator("#catalogItems .catalog-purchase-row").first.get_by_role("button", name="Tăng " + PRODUCTS[0]["name"], exact=True).dispatch_event("click")
    page.locator("#catalogClose").click()
    page.evaluate("async () => {for(let i=0;i<6;i++)await document.getElementById('sendForm').onsubmit({preventDefault(){}})}")
    notices = page.locator("#messages .bubble.note").filter(has_text="Đơn đã được ghi nhận")
    assert notices.count() <= 1, "At most one post-order warning"
    assert api.count("confirm") == 1
    saved_before = page.evaluate("key => sessionStorage.getItem(key)", SUBMITTED_KEY)
    page.locator("#realNewCartButton").click()
    expect(page.locator("#messageInput")).to_be_enabled()
    expect(page.locator("#sendForm button[type=submit]")).to_be_enabled()
    assert order_id(page) != first_id
    assert page.evaluate("key => sessionStorage.getItem(key)", SUBMITTED_KEY) == saved_before
    assert page.evaluate("key => sessionStorage.getItem(key)", PENDING_KEY) == ""
    assert api.count("catalogue") == 1, "New cart must retain authenticated catalogue"
    send(page, "2 thùng nước")
    page.locator("#quickCartEdit").click()
    page.locator("#quickCartQuote").click()
    expect(page.locator(".live-real-confirm").last).to_be_enabled()
    # Even a revived old DOM button cannot submit the new quote/order.
    page.evaluate("async () => {oldConfirm.disabled=false;await oldConfirm.onclick()}")
    assert api.count("confirm") == 1 and len(api.saved) == 1
    quote_bodies = [body for path, body in api.calls if path.endswith("/quote")]
    assert quote_bodies[0]["clientOrderId"] == first_id
    assert quote_bodies[1]["clientOrderId"] == order_id(page)
    page.locator("#historyButton").click()
    expect(page.locator("#historyItems")).to_contain_text("#7001")
    expect(page.locator("#historyItems")).to_contain_text("#7002")
    page.locator("#historyClose").click()
    # Reload keeps the new draft ID and does not reapply old submitted lock.
    second_id = order_id(page)
    page.reload()
    login(page)
    assert order_id(page) == second_id
    expect(page.locator("#messageInput")).to_be_enabled()
    assert not errors, errors
    assert not api.unexpected, api.unexpected
    if os.environ.get("CART_SCREENSHOTS"):
        out = Path(os.environ["CART_SCREENSHOTS"])
        out.mkdir(parents=True, exist_ok=True)
        send(page, "3 thùng nước")
        page.screenshot(path=str(out / f"{label}-collapsed.png"))
        page.locator("#quickCartEdit").click()
        page.screenshot(path=str(out / f"{label}-expanded.png"))
    context.close()
    print(f"PASS {label}: geometry, swipe, fake checkout, locks, new cart, history, duplicate guards", flush=True)


def uncertain_case(browser, origin, html):
    context = browser.new_context(viewport={"width": 360, "height": 740}, is_mobile=True, has_touch=True)
    api = FakeAPI(html, origin, uncertain=True)
    context.route("**/*", api.route)
    page = context.new_page()
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.goto(origin + "/#" + TOKEN)
    login(page)
    send(page)
    create_quote(page, api)
    page.locator(".live-real-confirm").click()
    expect(page.locator("#messageInput")).to_be_enabled()
    expect(page.locator("#messages")).to_contain_text("Mất phản hồi giả lập")
    oid = order_id(page)
    # The first new-cart attempt must open History, and must not renew the order.
    page.locator("#realNewCartButton").click()
    expect(page.locator("#historyBackdrop")).to_have_class(re.compile(r"\bopen\b"))
    assert order_id(page) == oid and api.count("confirm") == 1
    expect(page.locator("#messageInput")).to_be_enabled()
    page.locator("#historyClose").click()
    page.once("dialog", lambda dialog: dialog.dismiss())
    page.locator("#realNewCartButton").click()
    assert order_id(page) == oid
    page.once("dialog", lambda dialog: dialog.accept())
    page.locator("#realNewCartButton").click()
    expect(page.locator("#messageInput")).to_be_enabled()
    assert order_id(page) != oid and api.count("confirm") == 1
    assert len(api.saved) == 0
    assert not errors, errors
    assert not api.unexpected, api.unexpected
    context.close()
    print("PASS uncertain response: no retry; History gate and explicit new-order decision", flush=True)


def restored_submitted_case(browser, origin, html):
    context = browser.new_context(viewport={"width": 360, "height": 740})
    api = FakeAPI(html, origin)
    context.route("**/*", api.route)
    page = context.new_page()
    page.goto(origin + "/#" + TOKEN)
    oid = order_id(page)
    page.evaluate("([key,value])=>sessionStorage.setItem(key,value)",
                  [SUBMITTED_KEY, json.dumps({"orderId": oid, "invoiceNo": 7001, "invoiceNos": [7001], "overview": OLD_INVOICE})])
    page.reload()
    page.locator("#realCode").fill("test-pin")
    page.locator("#realOpen").click()
    expect(page.locator("#productionGeminiApp")).to_be_visible()
    expect(page.locator("#messageInput")).to_be_enabled()
    page.locator("#realNewCartButton").click()
    expect(page.locator("#messageInput")).to_be_enabled()
    assert order_id(page) != oid
    send(page)
    assert api.count("confirm") == 0
    context.close()
    print("PASS restored submitted session: new cart enables composer without a second login", flush=True)




def six_rows_case(browser, origin, html, viewport, ua, label):
    context = browser.new_context(viewport=viewport, user_agent=ua, is_mobile=True, has_touch=True)
    api = FakeAPI(html, origin)
    context.route("**/*", api.route)
    page = context.new_page()
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.goto(origin + "/#" + TOKEN)
    login(page)
    send(page, "6 loại sản phẩm")
    expect(page.locator(".real-cart-count")).to_have_text("21")
    collapsed_geometry(page)
    swipe(page, "up")
    settle_cart(page)
    rows = page.locator("#inlineCartLines .inline-cart-row")
    expect(rows).to_have_count(6)
    expect(page.locator("#quickCartQuote")).to_be_in_viewport()
    expect(page.locator(".delivery-note")).to_be_visible()
    # Only the product list scrolls. Its last row and delivery note remain reachable
    # while the header action stays visible on short screens.
    rows.last.scroll_into_view_if_needed()
    expect(page.locator("#quickCartQuote")).to_be_in_viewport()
    expect(page.locator(".delivery-note")).to_be_in_viewport()
    expect(rows.last).to_be_in_viewport()
    bounds = page.evaluate("""() => {
      const row=document.querySelector('#inlineCartLines .inline-cart-row:last-child');
      const box=e=>{const r=e.getBoundingClientRect();return {x:r.x,right:r.right}};
      return {row:box(row),parts:[...row.children].map(box),viewport:innerWidth};
    }""")
    assert bounds["row"]["right"] <= bounds["viewport"], bounds
    for part in bounds["parts"]:
        assert bounds["row"]["x"] <= part["x"] < part["right"] <= bounds["row"]["right"] + 1, bounds
    assert page.evaluate("document.documentElement.scrollWidth <= innerWidth")
    if os.environ.get("CART_SCREENSHOTS"):
        out = Path(os.environ["CART_SCREENSHOTS"])
        out.mkdir(parents=True, exist_ok=True)
        page.screenshot(path=str(out / f"{label}-six-rows.png"))
    swipe(page, "down")
    collapsed_geometry(page)
    assert api.count("quote") == api.count("confirm") == 0
    assert not errors, errors
    assert not api.unexpected, api.unexpected
    context.close()
    print(f"PASS {label}: six long product names, steppers, badge, pinned checkout and note", flush=True)


def pending_confirm_case(browser, origin, html):
    context = browser.new_context(viewport={"width": 360, "height": 740})
    api = FakeAPI(html, origin)
    api.defer_confirm = True
    context.route("**/*", api.route)
    page = context.new_page()
    page.goto(origin + "/#" + TOKEN)
    login(page)
    send(page)
    create_quote(page, api)
    oid = order_id(page)
    page.locator(".live-real-confirm").click()
    expect(page.locator(".real-checkout-progress")).to_be_visible()
    expect(page.locator(".real-checkout-progress")).to_contain_text("⏳ Đang xử lý đơn hàng")
    expect(page.locator("#messageInput")).to_be_disabled()
    expect(page.locator("#sendForm button[type=submit]")).to_be_disabled()
    expect(page.locator("#realNewCartButton")).to_be_disabled()
    page.evaluate("() => document.getElementById('realNewCartButton').onclick()")
    assert order_id(page) == oid
    assert api.count("confirm") == 1 and api.pending_confirm is not None
    # Closing the isolated browser cancels the deliberately paused fake response.
    context.close()
    print("PASS pending confirm: new-cart and composer stay locked; one request only", flush=True)


def guarded_case(fn, browser, origin, html, *args):
    try:
        return fn(browser, origin, html, *args)
    except Exception:
        out = Path(os.environ.get("CART_SCREENSHOTS", str(ROOT / "test-results/cart-screenshots")))
        out.mkdir(parents=True, exist_ok=True)
        for ci, context in enumerate(browser.contexts):
            for pi, page in enumerate(context.pages):
                try:
                    name = f"FAILED-{fn.__name__}-{ci}-{pi}"
                    page.screenshot(path=str(out / (name + ".png")))
                    (out / (name + ".html")).write_text(page.content())
                except Exception:
                    pass
        raise


def main():
    # Render precisely the production function used by server.mjs.
    html = subprocess.check_output([
        "node", "--input-type=module", "-e",
        "import fs from 'node:fs';import {renderOriginalGeminiProduction as render} from './customer-ai-chat-prototype/production-gemini-shell.mjs';process.stdout.write(render(fs.readFileSync('./customer-ai-chat-prototype/index.html','utf8'),fs.readFileSync('./customer-ai-chat-prototype/real-gemini-adapter.js','utf8')));",
    ], cwd=ROOT, text=True)
    class QuietHandler(SimpleHTTPRequestHandler):
        def log_message(self, *_):
            pass
    with tempfile.TemporaryDirectory() as fixture_dir:
        handler = lambda *args, **kwargs: QuietHandler(*args, directory=fixture_dir, **kwargs)
        with ThreadingHTTPServer(("127.0.0.1", 0), handler) as server:
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            origin = f"http://127.0.0.1:{server.server_port}"
            with sync_playwright() as p:
                options = {"headless": True, "args": ["--no-sandbox", "--disable-dev-shm-usage"]}
                if os.environ.get("CHROMIUM_EXECUTABLE"):
                    options["executable_path"] = os.environ["CHROMIUM_EXECUTABLE"]
                browser = p.chromium.launch(**options)
                samsung = "Mozilla/5.0 (Linux; Android 14; SM-S921B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/27.0 Chrome/125.0.0.0 Mobile Safari/537.36"
                chrome = "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36"
                iphone = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1"
                for width, height, ua, label in [
                    (360, 740, samsung, "samsung-360"), (320, 568, chrome, "small-320"),
                    (740, 360, samsung, "samsung-landscape"), (390, 844, iphone, "iphone-390"),
                ]:
                    guarded_case(success_case, browser, origin, html, {"width": width, "height": height}, ua, label)
                    guarded_case(six_rows_case, browser, origin, html, {"width": width, "height": height}, ua, label)
                guarded_case(uncertain_case, browser, origin, html)
                guarded_case(restored_submitted_case, browser, origin, html)
                guarded_case(pending_confirm_case, browser, origin, html)
                browser.close()
                if os.environ.get("CART_WEBKIT") == "1":
                    webkit = p.webkit.launch(headless=True)
                    guarded_case(success_case, webkit, origin, html, {"width": 390, "height": 844}, iphone, "webkit-iphone-390")
                    guarded_case(six_rows_case, webkit, origin, html, {"width": 390, "height": 844}, iphone, "webkit-iphone-390")
                    webkit.close()
            server.shutdown()
    print("PASS all production cart browser scenarios; fake API only; zero real invoices", flush=True)


if __name__ == "__main__":
    main()
