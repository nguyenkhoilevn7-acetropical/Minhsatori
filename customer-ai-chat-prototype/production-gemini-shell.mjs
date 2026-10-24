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
  '<p class="history-caution">Chỉ hiển thị hóa đơn đã xác nhận trong phiên này. Không giả lập lịch sử Google Drive.</p>');
 html=html.replace('Phiếu xác nhận đơn thử','Hóa đơn Minh Satori');
 html=html.replace('<a id="historyExcel"','<a id="historyExcel" hidden');
 html=html.replace(/<div class="history-tools">[\s\S]*?<\/div>/,'');
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
  '.production-gemini #quickCartNew{display:none}\n'+
  '@media(max-width:760px){.production-gemini-gate{margin:12vh 12px}.production-gemini .chat{height:var(--satori-visible-height,100dvh);min-height:0}.production-gemini #inlineCartLines{max-height:30dvh}.production-gemini .quick-cart{max-height:45dvh}}\n'+
  '</style>');
 // Client script controlled in this app, while original demo remains unchanged.
 return html+'<script>'+adapterJs.replaceAll('</script','<\\/script')+'</script>\n</body></html>';
}
