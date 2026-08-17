;!function(){try { var e="undefined"!=typeof globalThis?globalThis:"undefined"!=typeof global?global:"undefined"!=typeof window?window:"undefined"!=typeof self?self:{},n=(new e.Error).stack;n&&((e._debugIds|| (e._debugIds={}))[n]="fc151e1f-fb27-82e0-1311-c5fa0c7443a4")}catch(e){}}();
module.exports=[366447,e=>{"use strict";let t="2MRRW",i="https://www.2mrrw.com";function n(e){return e?new Date(e).toLocaleDateString("en-US",{weekday:"long",month:"long",day:"numeric",year:"numeric"}):""}function r(e){return String(e||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;")}function a({itemTitle:e,message:o,giftLink:s,expiresAt:l,coverUrl:p}){let d=n(l),g=o?.trim()?`<p style="margin:20px 0 0;font-size:15px;line-height:1.7;color:#d4c4ff;font-style:italic;">&ldquo;${r(o.trim())}&rdquo;</p>`:"",c=p?`<img src="${r(p)}" alt="" width="280" height="280" style="display:block;width:min(280px,88vw);height:auto;aspect-ratio:1;border-radius:16px;margin:0 auto 24px;border:1px solid rgba(162,89,255,0.35);box-shadow:0 24px 60px rgba(0,0,0,0.55);" />`:'<div style="width:200px;height:200px;margin:0 auto 24px;border-radius:16px;background:linear-gradient(135deg,#1a1030,#0a0a12);border:1px solid rgba(162,89,255,0.35);"></div>';return`<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/></head>
<body style="margin:0;padding:0;background:#050505;font-family:system-ui,-apple-system,sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#050505;">
    <tr><td align="center" style="padding:40px 16px;">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:520px;">
        <tr><td style="text-align:center;padding-bottom:8px;">
          <span style="font-size:11px;letter-spacing:4px;color:#00ffff;text-transform:uppercase;font-weight:700;">${t}</span>
        </td></tr>
        <tr><td style="text-align:center;padding-bottom:28px;">
          <h1 style="margin:0;font-size:26px;font-weight:900;color:#ffffff;line-height:1.25;">You received a gift</h1>
          <p style="margin:12px 0 0;font-size:14px;color:#888;line-height:1.6;">${r(e)} is waiting for you.</p>
        </td></tr>
        <tr><td style="text-align:center;background:linear-gradient(180deg,#0d0d14,#080808);border:1px solid #1e1e1e;border-radius:20px;padding:32px 24px;">
          ${c}
          ${g}
          <a href="${r(s)}" style="display:inline-block;margin-top:28px;padding:16px 36px;background:#00ffff;color:#000000;font-size:13px;font-weight:900;text-decoration:none;border-radius:10px;letter-spacing:1px;text-transform:uppercase;">Open Your Gift</a>
          <p style="margin:24px 0 0;font-size:12px;color:#666;line-height:1.6;">Claim within 15 days${d?` — expires ${r(d)}`:""}.</p>
        </td></tr>
        <tr><td style="text-align:center;padding-top:28px;font-size:11px;color:#444;line-height:1.6;">
          <a href="${i}" style="color:#555;text-decoration:none;">${i.replace(/^https?:\/\//,"")}</a><br/>
          &mdash; ${t}
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`}async function o({to:e,itemTitle:i,message:r,giftLink:s,expiresAt:l,coverUrl:p}){let d=`${t} gifted you something special`,g=n(l),c=r?.trim()?`

"${r.trim()}"
`:"",f=`${t} has gifted you: ${i}${c}

Open your gift:
${s}

This gift expires in 15 days${g?` on ${g}`:""}.

— ${t}`,m=a({itemTitle:i,message:r,giftLink:s,expiresAt:l,coverUrl:p}),h=process.env.RESEND_API_KEY;if(h){let t=process.env.GIFT_EMAIL_FROM||"2MRRW <gifts@2mrrw.com>",i=await fetch("https://api.resend.com/emails",{method:"POST",headers:{Authorization:`Bearer ${h}`,"Content-Type":"application/json"},body:JSON.stringify({from:t,to:[e],subject:d,text:f,html:m})});if(!i.ok){let e=await i.text().catch(()=>"");return console.warn("gift email send failed:",i.status,e),{sent:!1,subject:d,text:f}}return{sent:!0,subject:d,text:f}}return console.info("[gift-email]",{to:e,subject:d,giftLink:s}),{sent:!1,subject:d,text:f,loggedOnly:!0}}async function s({to:e,itemTitle:i,giftLink:r,expiresAt:o,coverUrl:l}){let p=`Your gift from ${t} expires in 5 days`,d=`You have an unclaimed gift: ${i}

Open your gift:
${r}

Expires: ${n(o)}

— ${t}`,g=a({itemTitle:i,message:"Your gift is still waiting — claim it before it expires.",giftLink:r,expiresAt:o,coverUrl:l}),c=process.env.RESEND_API_KEY;if(c){let t=process.env.GIFT_EMAIL_FROM||"2MRRW <gifts@2mrrw.com>",i=await fetch("https://api.resend.com/emails",{method:"POST",headers:{Authorization:`Bearer ${c}`,"Content-Type":"application/json"},body:JSON.stringify({from:t,to:[e],subject:p,text:d,html:g})});return i.ok?{sent:!0}:(console.warn("gift reminder email failed:",i.status),{sent:!1})}return console.info("[gift-reminder-email]",{to:e,subject:p,giftLink:r}),{sent:!1,loggedOnly:!0}}e.s(["buildGiftLink",0,function(e){return`${(process.env.NEXT_PUBLIC_SITE_URL||process.env.NEXT_PUBLIC_BASE_URL||i).replace(/\/+$/,"")}/gift/${e}`},"sendGiftEmail",0,o,"sendGiftReminderEmail",0,s])}];

//# debugId=fc151e1f-fb27-82e0-1311-c5fa0c7443a4
//# sourceMappingURL=src_lib_gifts_email_0ied2f2.js.map