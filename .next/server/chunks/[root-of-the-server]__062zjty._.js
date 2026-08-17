;!function(){try { var e="undefined"!=typeof globalThis?globalThis:"undefined"!=typeof global?global:"undefined"!=typeof window?window:"undefined"!=typeof self?self:{},n=(new e.Error).stack;n&&((e._debugIds|| (e._debugIds={}))[n]="73f3e0ba-37a2-7d90-d6b5-7e2c40a7acff")}catch(e){}}();
module.exports=[446786,(e,t,n)=>{t.exports=e.x("os",()=>require("os"))},427699,(e,t,n)=>{t.exports=e.x("events",()=>require("events"))},921517,(e,t,n)=>{t.exports=e.x("http",()=>require("http"))},524836,(e,t,n)=>{t.exports=e.x("https",()=>require("https"))},166559,e=>{"use strict";var t=e.i(103096);let n=new Map,i=null;function r(){if(i)return i;let e=process.env.UPSTASH_REDIS_REST_URL,n=process.env.UPSTASH_REDIS_REST_TOKEN;return e&&n?i=new t.Redis({url:e,token:n}):null}async function a(e){let t=r();if(t)try{return await t.get(`account:state:${e}`)||null}catch{}let i=n.get(e);return i?Date.now()>i.expiresAt?(n.delete(e),null):i.body:null}async function s(e,t){let i=r();if(i)try{await i.setex(`account:state:${e}`,30,t);return}catch{}if(n.set(e,{body:t,expiresAt:Date.now()+3e4}),n.size>500){let e=n.keys().next().value;void 0!==e&&n.delete(e)}}async function l(e){if(!e)return;let t=r();if(t)try{await t.del(`account:state:${e}`)}catch{}n.delete(e)}e.s(["getCachedState",0,a,"invalidateAccountStateCache",0,l,"setCachedState",0,s])},744814,e=>{"use strict";var t=e.i(942512),n=e.i(815386);async function i({userId:e,purchaseId:r,slugs:a,items:s=[],payment:l}){let o,c,p,d=[...new Set((a||[]).filter(n.isCollectorAccessSlug))];if(!d.length)return[];let u=(0,t.createAdminClient)(),{data:m,error:f}=await u.from("products").select("id, slug, title, product_type, metadata").in("slug",d);if(f)throw f;if(!m?.length)return[];let g=new Map((s||[]).map(e=>[e.slug,e])),h=(o=l?.shipping_details||l?.shipping||{},c=l?.customer_details||{},p=o.address||c.address||{},{name:o.name||c.name||null,email:c.email||l?.receipt_email||l?.metadata?.email||null,phone:o.phone||c.phone||l?.metadata?.phone||null,country:p.country||null,state:p.state||null,city:p.city||null,postalCode:p.postal_code||null,line1:p.line1||null,line2:p.line2||null}),y=new Date().toISOString(),_=m.map(t=>{var n;let i=g.get(t.slug)||{};return{user_id:e,product_id:t.id,purchase_id:r,product_slug:t.slug,title:t.title,collector_type:(n=t.slug,n?.startsWith("exc-bundle")?"collector_bundle":n?.startsWith("exc-card")?"collector_card":"verified_collectible"),sku:i.sku||t.metadata?.sku||t.slug,version:i.version||t.metadata?.version||i.badge||null,stripe_payment_intent_id:l?.object==="payment_intent"?l.id:"string"==typeof l?.payment_intent?l.payment_intent:l?.payment_intent?.id||null,stripe_checkout_session_id:l?.object==="checkout.session"?l.id:null,payment_status:"completed",verification_status:"verified",entitlement_status:"active",customer_email:h.email,customer_phone:h.phone,shipping_name:h.name,shipping_country:h.country,shipping_state:h.state,shipping_city:h.city,shipping_postal_code:h.postalCode,shipping_address_line1:h.line1,shipping_address_line2:h.line2,metadata:{item:i,payment_object:l?.object||null,source:"stripe_webhook"},purchased_at:y,verified_at:y}}),{data:x,error:b}=await u.from("collector_ownerships").upsert(_,{onConflict:"user_id,product_id"}).select("*");if(b){if((0,n.isMissingCollectorOwnershipsTable)(b))return console.warn("collector_ownerships table missing; skipping collector ledger write until migration is applied"),[];throw b}return x||[]}async function r({userId:e,purchaseId:i,slugs:a,items:s=[],payment:l}){if(!(a||[]).some(n.isVaultPassSlug))return null;let o=(0,t.createAdminClient)(),c=(s||[]).find(e=>(0,n.isVaultPassSlug)(e.slug))||{},{data:p,error:d}=await o.from("products").select("id, slug, title").eq("slug","vault-pass").maybeSingle();if(d)throw d;let u=l?.object==="payment_intent"?l.id:"string"==typeof l?.payment_intent?l.payment_intent:l?.payment_intent?.id||null,m=l?.object==="checkout.session"?l.id:null,f={user_id:e,entitlement_type:"vault_pass",access_tier:"vault_pass",source_type:"purchase",source_id:i,status:"active",renewal_state:"none",purchase_id:i,product_id:p?.id||null,stripe_payment_intent_id:u,stripe_checkout_session_id:m,metadata:{item:c,source:"stripe_webhook",payment_object:l?.object||null},starts_at:new Date().toISOString()},{data:g,error:h}=await o.from("vault_entitlements").upsert(f,{onConflict:"user_id,entitlement_type,source_type,source_id"}).select("*").single();if(h){if((0,n.isMissingSupabaseTable)(h))return console.warn("vault_entitlements table missing; skipping Vault Pass grant until migration is applied"),null;throw h}return g}var a=e.i(166559);async function s(e){let s=e.metadata?.guest_user_id||e.metadata?.user_id;if(!s)throw Error(`checkout session ${e.id} missing metadata.user_id`);let l=[];try{l=JSON.parse(e.metadata.slugs||"[]")}catch{l=[]}let o=[];try{o=JSON.parse(e.metadata.items||"[]")}catch{o=[]}let c=(0,t.createAdminClient)(),p=e.amount_total??0,{data:d,error:u}=await c.from("purchases").upsert({user_id:s,stripe_checkout_session_id:e.id,stripe_payment_intent_id:e.payment_intent||null,amount_cents:p,currency:e.currency||"usd",status:"completed",items:o,receipt_url:e.receipt_url||null,purchased_at:new Date().toISOString()},{onConflict:"stripe_checkout_session_id"}).select("id").single();if(u)throw u;return l.length>0&&await Promise.all([(0,n.grantLibraryItems)({userId:s,purchaseId:d.id,slugs:l,source:"purchase"}),i({userId:s,purchaseId:d.id,slugs:l,items:o,payment:e}),r({userId:s,purchaseId:d.id,slugs:l,items:o,payment:e})]),(0,a.invalidateAccountStateCache)(s).catch(()=>{}),{purchaseId:d.id,slugs:l}}async function l(e){if("succeeded"!==e.status)return null;let s=e.metadata?.guest_user_id||e.metadata?.user_id;if(!s)throw Error(`payment_intent ${e.id} missing metadata.user_id`);let l=[];try{l=JSON.parse(e.metadata.slugs||"[]")}catch{l=[]}let o=[];try{o=JSON.parse(e.metadata.items||"[]")}catch{o=[]}let c=(0,t.createAdminClient)(),{data:p,error:d}=await c.from("purchases").upsert({user_id:s,stripe_payment_intent_id:e.id,amount_cents:e.amount_received??e.amount,currency:e.currency||"usd",status:"completed",items:o,purchased_at:new Date().toISOString()},{onConflict:"stripe_payment_intent_id"}).select("id").single();if(d)throw d;return l.length>0&&await Promise.all([(0,n.grantLibraryItems)({userId:s,purchaseId:p.id,slugs:l,source:"purchase"}),i({userId:s,purchaseId:p.id,slugs:l,items:o,payment:e}),r({userId:s,purchaseId:p.id,slugs:l,items:o,payment:e})]),(0,a.invalidateAccountStateCache)(s).catch(()=>{}),{purchaseId:p.id,slugs:l,items:o}}e.s(["fulfillCheckoutSession",0,s,"fulfillPaymentIntent",0,l],744814)},696927,e=>{"use strict";let t="2MRRW";function n(){return(process.env.NEXT_PUBLIC_SITE_URL||process.env.NEXT_PUBLIC_BASE_URL||"https://www.2mrrw.com").replace(/\/+$/,"")}function i(e){return String(e||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;")}function r(e){let i=n();return`<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/></head>
<body style="margin:0;padding:0;background:#050505;font-family:system-ui,-apple-system,sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#050505;">
    <tr><td align="center" style="padding:40px 16px;">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:520px;">
        <tr><td style="text-align:center;padding-bottom:32px;">
          <span style="font-size:11px;letter-spacing:4px;color:#00ffff;text-transform:uppercase;font-weight:700;">${t}</span>
        </td></tr>
        ${e}
        <tr><td style="text-align:center;padding-top:28px;font-size:11px;color:#444;line-height:1.6;">
          <a href="${i}" style="color:#555;text-decoration:none;">${i.replace(/^https?:\/\//,"")}</a><br/>
          &mdash; ${t}
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`}async function a({to:e,subject:n,html:i,text:r}){if(!e)return{sent:!1};let s=process.env.RESEND_API_KEY;if(!s)return console.info("[email] no RESEND_API_KEY — logged only",{to:e,subject:n}),{sent:!1,loggedOnly:!0};try{let a=await fetch("https://api.resend.com/emails",{method:"POST",headers:{Authorization:`Bearer ${s}`,"Content-Type":"application/json"},body:JSON.stringify({from:process.env.TRANSACTIONAL_EMAIL_FROM||`${t} <no-reply@2mrrw.com>`,to:[e],subject:n,text:r||n,html:i})});if(!a.ok){let t=await a.text().catch(()=>"");return console.warn("[email] send failed",a.status,t.slice(0,200),{to:e,subject:n}),{sent:!1}}return{sent:!0}}catch(t){return console.warn("[email] send error",t?.message,{to:e,subject:n}),{sent:!1}}}e.s(["buildMembershipWelcomeEmail",0,function({name:e}){let a=n(),s=e?i(e.trim().split(/\s+/)[0]):"there";return{subject:"Welcome to the 2MRRW Inner Circle",html:r(`
    <tr><td style="text-align:center;padding-bottom:28px;">
      <h1 style="margin:0;font-size:24px;font-weight:900;color:#ffffff;line-height:1.25;">Welcome to the Inner Circle, ${s}</h1>
      <p style="margin:10px 0 0;font-size:14px;color:#888;">You now have full access to the 2MRRW digital ecosystem.</p>
    </td></tr>
    <tr><td style="background:linear-gradient(180deg,#0d0d14,#080808);border:1px solid #1e1e1e;border-radius:20px;padding:28px 24px;text-align:center;">
      <p style="margin:0 0 6px;font-size:13px;color:#888;text-transform:uppercase;letter-spacing:2px;font-weight:700;">What&apos;s unlocked</p>
      <p style="margin:12px 0 6px;font-size:15px;color:#ffffff;">Full streaming catalog</p>
      <p style="margin:0 0 6px;font-size:15px;color:#ffffff;">Vault &mdash; exclusive content &amp; archives</p>
      <p style="margin:0 0 6px;font-size:15px;color:#ffffff;">Premium livestreams</p>
      <p style="margin:0 0 24px;font-size:15px;color:#ffffff;">Inner Circle community</p>
      <a href="${a}" style="display:inline-block;padding:14px 32px;background:#00ffff;color:#000000;font-size:12px;font-weight:900;text-decoration:none;border-radius:10px;letter-spacing:1px;text-transform:uppercase;">Start Exploring</a>
    </td></tr>
  `),text:`Welcome to the 2MRRW Inner Circle, ${e||"there"}.

You now have full access:
• Full streaming catalog
• Vault — exclusive content & archives
• Premium livestreams
• Inner Circle community

Visit ${a} to get started.

— ${t}`}},"buildPurchaseConfirmationEmail",0,function({name:e,items:a,amountCents:s}){let l=n(),o=e?i(e.trim().split(/\s+/)[0]):"there",c="number"==typeof s?(s/100).toLocaleString("en-US",{style:"currency",currency:"USD"}):"",p=Array.isArray(a)&&a.length>0?a.map(e=>`<tr>
          <td style="padding:10px 0;font-size:14px;color:#ffffff;border-bottom:1px solid #181818;">${i(e.title||e.slug||"Item")}</td>
          <td style="padding:10px 0;font-size:14px;color:#aaa;text-align:right;border-bottom:1px solid #181818;">${null!=e.price?`$${Number(e.price).toFixed(2)}`:""}</td>
        </tr>`).join(""):'<tr><td colspan="2" style="padding:10px 0;font-size:14px;color:#888;">Your purchase</td></tr>',d=c?`<tr>
        <td style="padding:14px 0 0;font-size:12px;color:#888;font-weight:700;text-transform:uppercase;letter-spacing:1px;">Total</td>
        <td style="padding:14px 0 0;font-size:15px;color:#ffffff;font-weight:900;text-align:right;">${i(c)}</td>
      </tr>`:"",u=r(`
    <tr><td style="text-align:center;padding-bottom:28px;">
      <h1 style="margin:0;font-size:24px;font-weight:900;color:#ffffff;line-height:1.25;">Order confirmed, ${o}</h1>
      <p style="margin:10px 0 0;font-size:14px;color:#888;">Your music is ready in your library.</p>
    </td></tr>
    <tr><td style="background:linear-gradient(180deg,#0d0d14,#080808);border:1px solid #1e1e1e;border-radius:20px;padding:28px 24px;">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
        ${p}
        ${d}
      </table>
      <div style="text-align:center;margin-top:24px;">
        <a href="${l}" style="display:inline-block;padding:14px 32px;background:#00ffff;color:#000000;font-size:12px;font-weight:900;text-decoration:none;border-radius:10px;letter-spacing:1px;text-transform:uppercase;">Go to My Library</a>
      </div>
    </td></tr>
  `),m=[`Order confirmed, ${e||"there"}.`,"Your music is ready in your library.\n",Array.isArray(a)?a.map(e=>`• ${e.title||e.slug}`).join("\n"):"",c?`
Total: ${c}`:"",`
Visit ${l} to listen.

— ${t}`].join("\n").replace(/\n{3,}/g,"\n\n").trim();return{subject:`${t} — Your order is confirmed`,html:u,text:m}},"buildWelcomeEmail",0,function({name:e}){let a=n(),s=e?i(e.trim().split(/\s+/)[0]):"there";return{subject:"Welcome to 2MRRW",html:r(`
    <tr><td style="text-align:center;padding-bottom:28px;">
      <h1 style="margin:0;font-size:24px;font-weight:900;color:#ffffff;line-height:1.25;">Welcome, ${s}</h1>
      <p style="margin:10px 0 0;font-size:14px;color:#888;">You&apos;re in. The music is ready.</p>
    </td></tr>
    <tr><td style="background:linear-gradient(180deg,#0d0d14,#080808);border:1px solid #1e1e1e;border-radius:20px;padding:28px 24px;text-align:center;">
      <p style="margin:0 0 24px;font-size:15px;color:#d4c4ff;line-height:1.7;">Browse the catalog, purchase releases, collect music, and unlock exclusive content as a member or collector.</p>
      <a href="${a}" style="display:inline-block;padding:14px 32px;background:#00ffff;color:#000000;font-size:12px;font-weight:900;text-decoration:none;border-radius:10px;letter-spacing:1px;text-transform:uppercase;">Start Listening</a>
    </td></tr>
  `),text:`Welcome, ${e||"there"}.

You're in. The music is ready.

Browse the catalog, purchase releases, collect music, and unlock exclusive content.

Visit ${a} to get started.

— ${t}`}},"sendTransactionalEmail",0,a])},85570,e=>{e.v(e=>Promise.resolve().then(()=>e(609906)))}];

//# debugId=73f3e0ba-37a2-7d90-d6b5-7e2c40a7acff
//# sourceMappingURL=%5Broot-of-the-server%5D__062zjty._.js.map