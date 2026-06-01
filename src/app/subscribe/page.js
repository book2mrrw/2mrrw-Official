"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { loadStripe } from "@stripe/stripe-js";
import { Elements, ExpressCheckoutElement, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { useAuth } from "@/context/AuthContext";
import { resolveSubscriptionEntitlements } from "@/lib/commerce/entitlements";
import { stripePaymentOverlayStyle, stripePaymentPanelStyle, stripePaymentFormStyle } from "@/components/payments/stripePaymentShell";

const stripePromise = loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY);

const fadeUp = {
  initial: { opacity: 0, y: 24 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.7, ease: [0.22, 1, 0.36, 1] },
};

const unlocks = [
  "Full music access",
  "Full video access",
  "Exclusive releases",
  "Unreleased songs and snippets",
  "Demos and archive content",
  "Exclusive visuals and MP4 loops",
  "Behind-the-scenes archives",
  "Lyric access",
  "Member-only posts",
  "Early release access",
  "Premium livestream access",
  "Creative process content",
  "Subscriber-only content",
  "Future premium features",
];

const faqs = [
  ["Is this replacing purchases?", "No. Donate is one-time support, and physical products still require checkout. Inner Circle is the all-access layer for the digital ecosystem."],
  ["What does it unlock?", "Music, videos, exclusives, demos, archives, visuals, premium livestreams, creative process content, interviews, and future premium digital features."],
  ["How much is it?", "$7.99/month through Stripe recurring billing."],
  ["Will it work in the future app?", "Yes. Membership is account-linked, so website, mobile web, and future app clients can restore the same subscription state."],
];

export default function SubscribePage() {
  const { accountState, membership, refreshAccountState, loading: accountLoading } = useAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [subscriptionUnlocked, setSubscriptionUnlocked] = useState(false);
  const [subscriptionClientSecret, setSubscriptionClientSecret] = useState(null);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  const { isSubscriber, isLifetimeOwner, showSubscribe: showSubscribeButtons } =
    resolveSubscriptionEntitlements(accountState, membership);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (!params.get("subscribed")) return;
    setSubscriptionUnlocked(true);

    let attempts = 0;
    const sync = () => {
      attempts += 1;
      refreshAccountState?.().catch(() => {});
      if (attempts >= 5) window.clearInterval(interval);
    };
    sync();
    const interval = window.setInterval(sync, 2500);
    return () => window.clearInterval(interval);
  }, [refreshAccountState]);

  const startSubscription = async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/memberships/checkout", {
        method: "POST",
        credentials: "include",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not start subscription.");
      if (!data.clientSecret) throw new Error("No subscription payment secret returned.");
      setSubscriptionClientSecret(data.clientSecret);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const closeSubscriptionModal = () => {
    setSubscriptionClientSecret(null);
    setError("");
  };
  const handleSubscriptionSuccess = async () => {
    setSubscriptionClientSecret(null);
    setSubscriptionUnlocked(true);
    let attempts = 0;
    const sync = () => {
      attempts += 1;
      refreshAccountState?.().catch(() => {});
      if (attempts >= 5) window.clearInterval(interval);
    };
    sync();
    const interval = window.setInterval(sync, 2500);
  };
  const experienceUnlocked =
    subscriptionUnlocked || (!accountLoading && (isSubscriber || isLifetimeOwner));
  return (
    <main style={{minHeight:"100vh",background:"#050505",color:"#fff",fontFamily:"Inter, system-ui, -apple-system, BlinkMacSystemFont, sans-serif",overflow:"hidden"}}>
      <div style={{position:"fixed",inset:0,pointerEvents:"none",background:"radial-gradient(circle at 50% 12%,rgba(162,89,255,0.16),transparent 38%),radial-gradient(circle at 78% 72%,rgba(0,255,255,0.08),transparent 36%)"}}/>
      <div style={{position:"relative",maxWidth:1120,margin:"0 auto",padding:"28px 20px 80px"}}>
        <nav style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:16,marginBottom:64}}>
          <button onClick={()=>{window.location.href="/";}} style={{background:"transparent",border:"1px solid #222",color:"#777",borderRadius:999,padding:"9px 14px",fontSize:11,letterSpacing:2,textTransform:"uppercase",cursor:"pointer"}}>Back to 2MRRW</button>
          <div style={{fontSize:13,letterSpacing:5,fontWeight:900}}>2MRRW</div>
        </nav>

        <motion.section className="subscribe-hero" {...fadeUp} style={{minHeight:"68vh",display:"grid",gridTemplateColumns:"minmax(0,1.1fr) minmax(320px,0.9fr)",gap:36,alignItems:"center"}}>
          <div style={{minWidth:0}}>
            <div style={{fontSize:11,color:"#a259ff",letterSpacing:4,textTransform:"uppercase",fontWeight:800,marginBottom:18}}>Everything. One Membership.</div>
            <h1 style={{fontSize:"clamp(44px,8vw,104px)",lineHeight:0.9,letterSpacing:"-0.07em",margin:"0 0 24px",fontWeight:950}}>Unlock the 2MRRW experience</h1>
            <p style={{fontSize:"clamp(16px,2.3vw,22px)",lineHeight:1.6,color:"#aaa",maxWidth:620,margin:"0 0 30px"}}>One membership unlocks the full digital experience, including music, visuals, live streams, demos, archives, exclusive interviews, behind-the-scenes content, and subscriber-only releases.</p>
            <div style={{display:"flex",gap:12,alignItems:"center",flexWrap:"wrap"}}>
              {showSubscribeButtons && (
                <button className="subscribe-shimmer-button" onClick={startSubscription} disabled={loading}>{loading ? "Preparing..." : "Subscribe"}</button>
              )}
              <div style={{fontSize:12,color:"#666",letterSpacing:1}}>$7.99/month · full digital ecosystem access</div>
            </div>
            {experienceUnlocked && <p style={{fontSize:12,color:"#a259ff",lineHeight:1.7,marginTop:18}}>The 2MRRW experience is now unlocked.</p>}
            {error && <p style={{fontSize:12,color:"#ff8a8a",lineHeight:1.7,marginTop:18}}>{error}</p>}
          </div>

          <div className="member-card-wrap" style={{minWidth:0,width:"100%",border:"1px solid rgba(255,255,255,0.1)",borderRadius:32,padding:24,background:"linear-gradient(145deg,rgba(255,255,255,0.08),rgba(255,255,255,0.02))",boxShadow:"0 40px 100px rgba(0,0,0,0.45)",backdropFilter:"blur(18px)"}}>
            <div style={{aspectRatio:"1/1.15",borderRadius:24,background:"radial-gradient(circle at 50% 25%,rgba(162,89,255,0.55),transparent 34%),linear-gradient(160deg,#12091f,#050505 64%)",border:"1px solid rgba(162,89,255,0.22)",display:"flex",flexDirection:"column",justifyContent:"space-between",padding:24}}>
              <div>
                <div style={{fontSize:10,color:"#caa8ff",letterSpacing:4,textTransform:"uppercase",marginBottom:12}}>Member Pass</div>
                <div style={{fontSize:34,fontWeight:950,letterSpacing:"-0.04em"}}>INNER<br/>CIRCLE</div>
              </div>
              <div style={{display:"grid",gap:10}}>
                {["All music + video", "Digital exclusives", "Premium livestreams"].map(item => (
                  <div key={item} style={{padding:"12px 14px",border:"1px solid rgba(255,255,255,0.09)",borderRadius:14,background:"rgba(0,0,0,0.22)",fontSize:13,color:"#ddd"}}>{item}</div>
                ))}
              </div>
            </div>
          </div>
        </motion.section>

        <section style={{padding:"84px 0 26px"}}>
          <div style={{fontSize:11,color:"#666",letterSpacing:4,textTransform:"uppercase",marginBottom:16}}>Unlock The Full Ecosystem</div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(180px,1fr))",gap:12}}>
            {unlocks.map((item, index) => (
              <motion.div key={item} initial={{opacity:0,y:18}} whileInView={{opacity:1,y:0}} viewport={{once:true}} transition={{delay:index*0.035,duration:0.45}} style={{padding:"18px 16px",border:"1px solid #171717",borderRadius:18,background:"#090909",color:"#ddd",fontSize:14,lineHeight:1.4}}>
                {item}
              </motion.div>
            ))}
          </div>
        </section>

        <section className="feature-panels" style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(260px,1fr))",gap:18,padding:"44px 0"}}>
          <div style={{minHeight:260,border:"1px solid rgba(0,255,255,0.14)",borderRadius:28,padding:24,background:"linear-gradient(145deg,rgba(0,255,255,0.08),rgba(255,255,255,0.02))"}}>
            <div style={{fontSize:11,color:"#00ffff",letterSpacing:3,textTransform:"uppercase",marginBottom:14}}>Full Video Access</div>
            <h2 style={{fontSize:32,lineHeight:1,letterSpacing:"-0.04em",margin:"0 0 14px"}}>Visuals, loops, worlds.</h2>
            <p style={{color:"#777",lineHeight:1.8,fontSize:14}}>Unlock videos, MP4 loops, early visuals, demo clips, and behind-the-scenes moments before they become public.</p>
          </div>
          <div style={{minHeight:260,border:"1px solid rgba(162,89,255,0.2)",borderRadius:28,padding:24,background:"linear-gradient(145deg,rgba(162,89,255,0.1),rgba(255,255,255,0.02))"}}>
            <div style={{fontSize:11,color:"#caa8ff",letterSpacing:3,textTransform:"uppercase",marginBottom:14}}>Digital Exclusives</div>
            <h2 style={{fontSize:32,lineHeight:1,letterSpacing:"-0.04em",margin:"0 0 14px"}}>Inside the process.</h2>
            <p style={{color:"#777",lineHeight:1.8,fontSize:14}}>Membership is designed for unreleased snippets, alternate versions, interviews, updates, archived ideas, and subscriber-only digital drops. Physical products remain separate purchases.</p>
          </div>
        </section>

        <section style={{padding:"36px 0 72px"}}>
          <div className="faq-layout" style={{display:"grid",gridTemplateColumns:"minmax(0,0.8fr) minmax(0,1.2fr)",gap:28,alignItems:"start"}}>
            <div>
              <div style={{fontSize:11,color:"#666",letterSpacing:4,textTransform:"uppercase",marginBottom:14}}>Subscriber Experience</div>
              <h2 style={{fontSize:"clamp(32px,5vw,58px)",lineHeight:0.95,letterSpacing:"-0.06em",margin:"0 0 18px"}}>Not a paywall. The full room.</h2>
            </div>
            <div style={{display:"grid",gap:12}}>
              {faqs.map(([q,a]) => (
                <div key={q} style={{padding:"18px 20px",border:"1px solid #171717",borderRadius:18,background:"#080808"}}>
                  <div style={{fontWeight:800,marginBottom:8}}>{q}</div>
                  <div style={{fontSize:14,color:"#777",lineHeight:1.7}}>{a}</div>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section style={{padding:"34px 22px",border:"1px solid rgba(255,255,255,0.1)",borderRadius:28,background:"linear-gradient(90deg,rgba(255,255,255,0.08),rgba(162,89,255,0.08))",display:"flex",alignItems:"center",justifyContent:"space-between",gap:18,flexWrap:"wrap"}}>
          <div>
            <div style={{fontSize:24,fontWeight:900,letterSpacing:"-0.04em",marginBottom:6}}>Everything. One membership.</div>
            <div style={{fontSize:13,color:"#888"}}>$7.99/month for music, visuals, archives, exclusives, premium livestreams, creative process content, and future digital features.</div>
          </div>
          {showSubscribeButtons && (
            <button className="subscribe-shimmer-button purple" onClick={startSubscription} disabled={loading}>{loading ? "Preparing..." : "Subscribe"}</button>
          )}
        </section>
      </div>

      <AnimatePresence>
        {subscriptionClientSecret && (
          <motion.div
            initial={{opacity:0}}
            animate={{opacity:1}}
            exit={{opacity:0}}
            style={{...stripePaymentOverlayStyle({ isMobile, padding: isMobile ? 0 : 16 }), background:"rgba(0,0,0,0.9)"}}
          >
            <motion.div
              initial={{opacity:0,y:18,scale:.98}}
              animate={{opacity:1,y:0,scale:1}}
              exit={{opacity:0,y:12,scale:.98}}
              onClick={(e) => e.stopPropagation()}
              style={{
                ...stripePaymentPanelStyle({ isMobile, maxWidth: 420 }),
                background:"#0a0a0a",
                padding: "28px 28px max(28px, env(safe-area-inset-bottom))",
                borderRadius: isMobile ? "20px 20px 0 0" : 22,
                border:"1px solid #222",
                boxShadow:"0 30px 90px rgba(0,0,0,.55)",
                alignSelf: isMobile ? "flex-end" : "center",
              }}
            >
              <div style={{fontSize:11,color:"#a259ff",letterSpacing:3,marginBottom:12,textTransform:"uppercase"}}>Inner Circle</div>
              <div style={{fontSize:24,fontWeight:950,letterSpacing:"-0.04em",marginBottom:8}}>Complete membership</div>
              <div style={{fontSize:13,color:"#777",lineHeight:1.7,marginBottom:18}}>$7.99/month. Wallets, Link, and card stay inside the site.</div>
              <Elements stripe={stripePromise} options={{clientSecret:subscriptionClientSecret,appearance:{theme:"night",variables:{colorPrimary:"#a259ff",colorBackground:"#0a0a0a",colorText:"#ffffff",borderRadius:"8px"}}}}>
                <SubscriptionPaymentForm onSuccess={handleSubscriptionSuccess}/>
              </Elements>
              <button onClick={closeSubscriptionModal} style={{marginTop:10,width:"100%",padding:10,background:"none",border:"1px solid #333",color:"#777",cursor:"pointer",borderRadius:8}}>Cancel</button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <style>{`
        @media (max-width: 760px) {
          nav { margin-bottom: 36px !important; }
        }
        @media (max-width: 900px) {
          .subscribe-hero,
          .feature-panels,
          .faq-layout {
            grid-template-columns: 1fr !important;
          }
          .subscribe-hero {
            min-height: auto !important;
            gap: 28px !important;
          }
          .member-card-wrap {
            max-width: 360px !important;
            justify-self: center !important;
            padding: 20px !important;
          }
        }
        @keyframes subscribeSweep {
          0% { transform: translateX(-145%) skewX(-18deg); opacity: 0; }
          22% { opacity: .42; }
          54% { opacity: .18; }
          100% { transform: translateX(190%) skewX(-18deg); opacity: 0; }
        }
        .subscribe-shimmer-button {
          position: relative;
          overflow: hidden;
          padding: 15px 28px;
          background: #fff;
          color: #000;
          border: none;
          border-radius: 999px;
          font-size: 13px;
          font-weight: 900;
          letter-spacing: 1.5px;
          text-transform: uppercase;
          cursor: pointer;
          box-shadow: 0 0 28px rgba(255,255,255,.12);
        }
        .subscribe-shimmer-button.purple {
          padding: 14px 24px;
          background: #a259ff;
          color: #fff;
          box-shadow: 0 0 36px rgba(162,89,255,.22);
        }
        .subscribe-shimmer-button::after {
          content: "";
          position: absolute;
          top: -30%;
          bottom: -30%;
          left: 0;
          width: 42%;
          background: linear-gradient(90deg, transparent, rgba(255,255,255,.5), transparent);
          animation: subscribeSweep 5.8s ease-in-out infinite;
          pointer-events: none;
        }
      `}</style>
    </main>
  );
}

function SubscriptionPaymentForm({ onSuccess }) {
  const stripe = useStripe();
  const elements = useElements();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const confirmSubscription = async () => {
    if (!stripe || !elements) return;
    setLoading(true);
    setError("");
    const submit = await elements.submit();
    if (submit.error) {
      setError(submit.error.message || "Subscription payment failed.");
      setLoading(false);
      return;
    }
    const result = await stripe.confirmPayment({
      elements,
      confirmParams: { return_url: `${window.location.origin}/subscribe?subscribed=1` },
      redirect: "if_required",
    });
    if (result.error) {
      setError(result.error.message || "Subscription payment failed.");
      setLoading(false);
      return;
    }
    onSuccess();
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    await confirmSubscription();
  };

  return (
    <form onSubmit={handleSubmit} style={stripePaymentFormStyle()}>
      <ExpressCheckoutElement
        options={{
          buttonTheme: { applePay: "black", googlePay: "black", link: "black" },
          buttonType: { applePay: "plain", googlePay: "subscribe" },
          emailRequired: true,
        }}
        onConfirm={confirmSubscription}
      />
      <div style={{display:"flex",alignItems:"center",gap:10,margin:"16px 0"}}>
        <div style={{height:1,background:"#1e1e1e",flex:1}}/>
        <div style={{fontSize:10,color:"#555",letterSpacing:2,textTransform:"uppercase"}}>or continue</div>
        <div style={{height:1,background:"#1e1e1e",flex:1}}/>
      </div>
      <PaymentElement options={{layout:"tabs"}}/>
      <button type="submit" disabled={!stripe||loading} style={{marginTop:20,width:"100%",padding:12,background:"#a259ff",color:"#fff",fontWeight:900,border:"none",borderRadius:8,cursor:"pointer"}}>{loading ? "Processing..." : "Subscribe Now"}</button>
      {error && <p style={{color:"#ff8a8a",fontSize:12,marginTop:10}}>{error}</p>}
    </form>
  );
}
