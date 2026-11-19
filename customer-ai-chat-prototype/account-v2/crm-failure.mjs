/** Fixed diagnostics only: never expose SQL text, IDs, credentials or driver detail. */
export function classifyCrmFailure(error){
 if(error?.code==='23505'&&error?.constraint==='satori_v2_customer_leads_linked_account_id_key')
  return {code:'LEGACY_LINK_MIGRATION_REQUIRED',status:503,
   message:'Database chưa hỗ trợ nhiều điểm giao cho một Gmail. Cần hoàn tất migration CRM.'};
 const upstream=new Set(['READ_ONLY_NOT_CONFIGURED','READ_ONLY_UPSTREAM_ERROR',
  'READ_ONLY_NON_JSON_RESPONSE','READ_ONLY_RESPONSE_TOO_LARGE','READ_ONLY_UPSTREAM_HTTP_500',
  'READ_ONLY_UPSTREAM_HTTP_502','READ_ONLY_UPSTREAM_HTTP_503','READ_ONLY_UPSTREAM_HTTP_504']);
 if(upstream.has(error?.message)||error?.name==='AbortError')
  return {code:'LEGACY_SOURCE_UNAVAILABLE',status:503,
   message:'Chưa xác minh được sổ hóa đơn gốc. Tài khoản không bị đổi trạng thái; hãy tra cứu lại.'};
 if(['40001','40P01','55P03'].includes(error?.code))
  return {code:'CRM_CONCURRENT_UPDATE',status:409,
   message:'Dữ liệu đang được cập nhật đồng thời. Hãy tải lại trước khi liên kết.'};
 return {code:'ACCOUNT_V2_UNAVAILABLE',status:503,
  message:'Chưa xử lý được yêu cầu. Cung cấp mã tra cứu lỗi cho quản trị viên.'};
}
export function crmFailureLog(error,{requestId,route,code}){
 const routes=new Set(['/api/v2/admin/legacy/bind-history','/api/v2/admin/legacy/activate-saved',
  '/api/v2/admin/legacy/search','/api/v2/admin/legacy/address-directory',
  '/api/v2/admin/legacy/reconcile-pending','/api/v2/admin/legacy/check']);
 return {event:'CRM_REQUEST_FAILED',requestId,route:routes.has(route)?route:'other',code,
  sqlState:/^[0-9A-Z]{5}$/.test(error?.code||'')?error.code:null};
}
