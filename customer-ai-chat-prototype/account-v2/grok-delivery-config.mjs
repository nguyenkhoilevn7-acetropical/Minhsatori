// Explicit opt-out preserves existing installations until configured at rollout.
export const grokDeliveryEnabled=(env=process.env)=>env.GROK_PDF_DELIVERY_ENABLED!=='0';
