/**
 * Production /real shell, rendered from the EXACT existing Gemini demo document.
 * HTML/CSS/layout and native components remain in index.html: one design source.
 * Only sandbox-specific JS is replaced with the authenticated real-order adapter.
 */
export function renderOriginalGeminiProduction(originalHtml,adapterJs){
 if(typeof originalHtml!=='string'||typeof adapterJs!=='string')throw Error('GEMINI_SHELL_INVALID');
 const cut=originalHtml.indexOf('<script>');
 if(cut<0||originalHtml.indexOf('<script>',cut+1)>=0||!originalHtml.includes('class="card chat"'))
  throw Error('GEMINI_ORIGINAL_TEMPLATE_MISMATCH');
 let html=originalHtml.slice(0,cut);
 const remove=(re)=>{if(!re.test(html))throw Error('GEMINI_ORIGINAL_MARKUP_CHANGED');html=html.replace(re,'')};
 remove(/<aside class="card panel" id="panel">[\s\S]*?<\/aside>/);
 remove(/<header class="top">[\s\S]*?<\/header>/);
 remove(/<p class="footnote">[\s\S]*?<\/p>/);
 html=html.replace('<body>','<body class="server-mode production-gemini">');
 html=html.replace('<div class="app">','<div class="app" id="productionGeminiApp" hidden>');
 html=html.replace('Trợ lý đặt nước Minh Satori','Trợ lý đặt nước Minh Satori');
 html=html.replace('Khách thử • mô phỏng luồng ChatGPT','Đặt hàng thật • Bảng giá được duyệt riêng');
 html=html.replace('id="historyButton">🧾 Lịch sử &amp; Excel','id="historyButton">🧾 Hóa đơn');
 html=html.replace(/<p class="history-caution">[\s\S]*?<\/p>/,
  '<p class="history-caution">Hóa đơn đọc trực tiếp từ Google Drive, chỉ của người nhận và địa chỉ trong link được duyệt. Nếu quá 100 kết quả, hệ thống cảnh báo lịch sử chưa đầy đủ.</p>');
 html=html.replace('Phiếu xác nhận đơn thử','Hóa đơn Minh Satori');
 html=html.replace('<a id="historyExcel"','<a id="historyExcel" hidden');
 // Keep the ORIGINAL Gemini month and search filters; add status filter within them.
 html=html.replace('<div class="history-tools">',
  '<div class="history-tools"><label>Thanh toán<select id="historyStatus"><option value="">Tất cả</option><option value="paid">Đã thanh toán</option><option value="unpaid">Chưa thanh toán</option></select></label>');
 // These controls are source-compatible but controlled by real authenticated
 // /api/real/{catalogue,interpret,quote,confirm}; no fake /api/draft writes.
 const gate='<section class="production-gemini-gate" id="realGate" role="form" aria-label="Mở link đặt nước">'+
  '<img src="/assets/logo-satori.jpg" width="59" height="59" alt="Minh Satori">'+
  '<h1>MINH SATORI</h1><p>Nhập mã truy cập riêng để mở trợ lý đặt nước của bạn.</p>'+
  '<label for="realCode">Mã truy cập riêng</label>'+
  '<input id="realCode" type="password" autocomplete="off" maxlength="100">'+
  '<button id="realOpen" type="button">Mở trợ lý đặt hàng</button>'+
  '<p id="realGateStatus" role="status"></p></section>';
 html=html.replace('<div class="app" id="productionGeminiApp" hidden>',gate+
  '<div class="app" id="productionGeminiApp" hidden>');
 html=html.replace('</style>','\n'+
  '[hidden]{display:none!important}\n'+
  '.production-gemini{background:#eef2f7;color:#18283c}\n'+
  '.production-gemini-gate{max-width:470px;margin:15vh auto 20px;background:white;border:1px solid #dfebfa;'+
  'border-radius:21px;box-shadow:0 13px 40px #142f5424;padding:28px 25px;text-align:center;color:#1c3552}\n'+
  '.production-gemini-gate img{object-fit:contain;border-radius:13px}\n'+
  '.production-gemini-gate h1{margin:10px 0;font-size:21px}\n'+
  '.production-gemini-gate p{font-size:13px;color:#566b80}\n'+
  '.production-gemini-gate label{display:block;text-align:left;font-size:13px;font-weight:700}\n'+
  '.production-gemini-gate input{width:100%;border:1px solid #d3e1f2;border-radius:12px;'+
  'font-size:16px;box-sizing:border-box;padding:13px;margin:8px 0 12px}\n'+
  '.production-gemini-gate button{background:#087aff;border:0;border-radius:12px;color:white;'+
  'padding:12px 18px;font-weight:750;font-size:14px;min-height:44px}\n'+
  '#realGateStatus{white-space:pre-wrap;color:#b04731}\n'+
  '.production-gemini .chat{min-height:calc(100dvh - 25px)}\n'+
  '.production-gemini .shop-hero{display:flex}\n'+
  '.production-gemini .messages{scroll-behavior:smooth}\n'+
  /* Same original grid as the Gemini demo; never override it with flex. */
  '.production-gemini .quick-cart{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:5px 8px;max-height:min(49dvh,350px);overflow-y:auto}\n'+
  '.production-gemini .quick-cart[hidden]{display:none!important}\n'+
  '.production-gemini #inlineCartLines{max-height:min(32dvh,250px);overflow-y:auto;grid-column:1/-1;scrollbar-width:thin}\n'+
  '.production-gemini .inline-cart-row{grid-template-columns:minmax(0,1fr) minmax(116px,128px) 29px;gap:5px;min-width:0}\n'+
  '.production-gemini .inline-cart-row .suggestion-steps{display:grid;grid-template-columns:31px minmax(0,1fr) 31px;gap:3px;min-width:0;overflow:visible;white-space:normal}\n'+
  '.production-gemini .inline-cart-row .suggestion-steps button{min-width:31px;padding:0;display:grid;place-items:center}\n'+
  '.production-gemini .inline-cart-row .suggestion-steps input{min-width:0;width:100%;max-width:100%;box-sizing:border-box}\n'+
  '.production-gemini .delivery-note-block{grid-column:1/-1;margin:4px 0}\n'+
  '.production-gemini .delivery-note-label{font-size:12px;font-weight:700;color:#1f5779}\n'+
  '.production-gemini .delivery-note{display:block;min-height:43px;max-height:76px;width:100%;font-size:14px;border:1px solid #c9ddeb;border-radius:11px;padding:8px;background:white;color:#183047}\n'+
  '.production-gemini .catalog-launch-bar{display:grid}\n'+
  '.production-gemini #quickCartNew{display:inline-flex!important;align-items:center;justify-content:center;background:#1078d6;color:#fff;border-radius:10px;min-height:37px;padding:7px 11px;font-weight:750}\n'+
  '.production-gemini #locationsPanel button{display:block;width:100%;margin:8px 0;padding:14px 16px;border:1px solid #bdd9f0;border-radius:14px;background:linear-gradient(120deg,#f4fbff,#e3f4fe);color:#164469;box-shadow:0 3px 9px #1d6fb116;text-align:left;font-weight:650;font-size:14px;line-height:1.5}\n'+
  '.production-gemini #locationsPanel button[aria-pressed=true]{background:linear-gradient(120deg,#d5edff,#c2e8ff);border:2px solid #1686cb;box-shadow:0 3px 12px #1783ca26}\n'+
  '.production-gemini .real-catalog-row{display:flex;align-items:center;gap:9px;border-left:4px solid #bcd7ee;padding:9px 11px;border-radius:11px;margin:5px 0;box-sizing:border-box;box-shadow:0 2px 8px #19426d0a}\n'+
  '.production-gemini .real-catalog-row.in-cart{background:#dceeff!important;border-left:5px solid #087aff;box-shadow:0 1px 11px #087aff25}\n'+
  '.production-gemini .real-catalog-row.is-selected{outline:2px solid #0b81ec;outline-offset:-1px}\n'+
  '.production-gemini .real-product-picker{display:flex;align-items:center;gap:8px;min-width:0;flex:1;background:transparent;border:0;color:#163653;text-align:left;padding:0;cursor:pointer}\n'+
  '.production-gemini .real-product-picker .catalog-label{font-size:13px;line-height:1.32;overflow-wrap:anywhere}\n'+
  '.production-gemini .real-product-picker .catalog-label small{display:block;font-weight:500;color:#426c93;font-size:11px}\n'+
  '.production-gemini .real-catalog-stepper{flex:0 0 124px;display:grid;grid-template-columns:34px minmax(0,1fr) 34px;gap:3px;align-items:center}\n'+
  '.production-gemini .real-catalog-stepper input{width:100%;min-width:0;box-sizing:border-box;border:1px solid #b8d0e5;border-radius:7px;padding:6px 1px;text-align:center;font-size:15px;font-weight:750;background:#fff;color:#133d5a}\n'+
  '.production-gemini .real-catalog-stepper .real-step{height:36px;min-width:32px;border:0;border-radius:9px;color:white;background:#087aff;font-size:19px;font-weight:800;padding:0}\n'+
  '.production-gemini .real-catalog-stepper .real-step.minus{background:#d9edff;color:#065d9d;border:1px solid #aed3f3}\n'+
  '.production-gemini .quote .live-real-confirm{background:#087aff;color:white;border:2px solid #0361b6;font-size:15px;font-weight:800;min-height:49px;box-shadow:0 3px 12px #137acb2e}\n'+
  '.production-gemini .quote.quote-submitted{background:#eefbf5;border:2px solid #34a26f}\n'+
  '.production-gemini .quote .live-real-confirm.is-submitted{background:#17875d!important;border-color:#17875d;color:#fff;opacity:1!important;cursor:default}\n'+
  '.production-gemini .quote .live-real-confirm.is-uncertain{background:#b55f21!important;border-color:#b55f21;color:#fff;opacity:1!important}\n'+
  '.production-gemini .quote .live-real-confirm.is-submitting{background:#9daec0!important;color:#183f58;opacity:1!important}\n'+
  '.production-gemini .real-view-submitted{background:#fff;color:#0872bd;border:1px solid #8fc9e5;margin:9px 0 0;font-weight:750}\n'+
  '@media(max-width:390px){.production-gemini .real-catalog-stepper{flex-basis:110px;grid-template-columns:30px minmax(0,1fr) 30px}.production-gemini .real-catalog-row{padding:7px 6px}}\n'+
  '.production-gemini .real-history-order{padding:13px;border:1px solid #d1e4f6;background:#fff;border-radius:14px;margin:9px 0}\n'+
  '.production-gemini .real-history-order strong{color:#164d7a}.production-gemini .real-history-order small{display:block;color:#66788c;line-height:1.6}\n'+
  '.production-gemini .real-history-order button{margin-top:9px;background:#0c76ca;color:#fff;border:0;border-radius:9px;padding:8px 12px}\n'+
  '.production-gemini .real-invoice-preview{font-family:Arial,sans-serif;background:white;border:1px solid #d5e1ec;border-radius:13px;padding:13px;color:#1f2e42}\n'+
  '.production-gemini .real-invoice-preview h3{font-size:17px;color:#0d6385;margin:4px 0 12px}\n'+
  '.production-gemini .real-invoice-line{display:flex;justify-content:space-between;gap:12px;padding:9px 0;border-bottom:1px solid #edf1f4}\n'+
  '.production-gemini .real-invoice-line strong{white-space:nowrap;text-align:right}\n'+
  '.production-gemini .real-invoice-total{font-size:17px;font-weight:800;color:#006f8f}\n'+
  '@media(max-width:760px){.production-gemini-gate{margin:12vh 12px}.production-gemini .chat{height:var(--satori-visible-height,100dvh);min-height:0}.production-gemini #inlineCartLines{max-height:30dvh}.production-gemini .quick-cart{max-height:45dvh}}\n'+
  '</style>');
 // Client script controlled in this app, while original demo remains unchanged.
 return html+'<script>'+adapterJs.replaceAll('</script','<\\/script')+'</script>\n</body></html>';
}
