/**
 * Exclusive V2 CRM validation. No old invoice tables or passwords.
 * All identity binding requires Google-signed sub, never email/phone alone.
 */
const fail=(code)=>{const e=new Error(code);e.code=code;throw e};
const text=(value,max,required=false)=>{
 if(typeof value!=='string')return required?fail('CUSTOMER_REQUIRED_FIELD'):'';
 const s=value.trim();
 if((required&&!s)||s.length>max)return fail('CUSTOMER_FIELD_INVALID');
 return s;
};
export const customerTypes=Object.freeze(['retail','agency','collaborator']);
export const customerStates=Object.freeze(['PENDING','ACTIVE','SUSPENDED','REMOVED']);
export function validateCustomerProfile(input,{admin=false}={}){
 if(!input||typeof input!=='object'||Array.isArray(input))fail('CUSTOMER_OBJECT_REQUIRED');
 if(Object.keys(input).some(k=>/pass(?:word)?|secret|token|otp|pin|credential/i.test(k)))
  fail('CUSTOMER_PASSWORD_NOT_ACCEPTED');
 const fullName=text(input.fullName,120,true);
 const phone=text(input.phone,24,true).replace(/[ ().-]/g,'');
 if(!/^\+?[0-9]{9,15}$/.test(phone))fail('CUSTOMER_PHONE_INVALID');
 const address=text(input.address,400,true);
 const email=text(input.email||'',254,false).toLowerCase();
 if(email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))fail('CUSTOMER_EMAIL_INVALID');
 const requestedType=input.requestedType||'retail';
 if(!customerTypes.includes(requestedType))fail('CUSTOMER_ROLE_INVALID');
 const discountBps=admin?input.discountBps??0:0;
 if(!Number.isSafeInteger(discountBps)||discountBps<0||discountBps>10000)
  fail('CUSTOMER_DISCOUNT_INVALID');
 return Object.freeze({fullName,phone,address,email,
  companyName:text(input.companyName||'',160),
  taxCode:text(input.taxCode||'',35),
  note:text(input.note||'',350),
  requestedType,discountBps});
}
export function validateCustomerStatus(input){
 if(!input||typeof input!=='object')fail('CUSTOMER_UPDATE_INVALID');
 if(input.confirmed!==true)fail('OWNER_CONFIRMATION_REQUIRED');
 if(!customerStates.includes(input.status)||input.status==='PENDING')fail('CUSTOMER_STATUS_INVALID');
 if(!Number.isSafeInteger(input.expectedRevision)||input.expectedRevision<1)fail('CUSTOMER_REVISION_REQUIRED');
 if(input.discountBps!==undefined&&(!Number.isSafeInteger(input.discountBps)||
  input.discountBps<0||input.discountBps>10000))fail('CUSTOMER_DISCOUNT_INVALID');
 return {status:input.status,expectedRevision:input.expectedRevision,
  discountBps:input.discountBps};
}
export const publicCustomerFields=Object.freeze([
 'id','email','name','fullName','phone','address','companyName','taxCode',
 'note','requestedType','accessStatus','revision','createdAt','updatedAt'
]);
