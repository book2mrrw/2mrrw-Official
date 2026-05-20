"use client";

import { memo, useState } from "react";
import { AddressElement, ExpressCheckoutElement, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";

function CheckoutForm({ onSuccess, requiresShipping, submitLabel = "Pay Now" }) {
  const stripe   = useStripe();
  const elements = useElements();
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState("");
  const handleExpressConfirm = async () => {
    if (!stripe || !elements) return;
    setLoading(true); setError("");
    const submit = await elements.submit();
    if (submit.error) {
      setError(submit.error.message || "Wallet checkout failed.");
      setLoading(false);
      return;
    }
    const result = await stripe.confirmPayment({ elements, redirect:"if_required" });
    if (result.error) { setError(result.error.message || "Wallet payment failed."); setLoading(false); }
    else { onSuccess(result.paymentIntent?.id); }
  };
  const handleSubmit = async e => {
    e.preventDefault();
    if (!stripe || !elements) return;
    setLoading(true); setError("");
    const submit = await elements.submit();
    if (submit.error) {
      setError(submit.error.message || "Payment failed.");
      setLoading(false);
      return;
    }
    const result = await stripe.confirmPayment({ elements, redirect:"if_required" });
    if (result.error) { setError(result.error.message || "Payment failed."); setLoading(false); }
    else { onSuccess(result.paymentIntent?.id); }
  };
  return (
    <form onSubmit={handleSubmit}>
      <ExpressCheckoutElement
        options={{
          buttonTheme: { applePay: "black", googlePay: "black", link: "black" },
          buttonType: { applePay: "plain", googlePay: "pay" },
          emailRequired: true,
          phoneNumberRequired: Boolean(requiresShipping),
          shippingAddressRequired: Boolean(requiresShipping),
          allowedShippingCountries: ["US"],
        }}
        onConfirm={handleExpressConfirm}
      />
      <div style={{display:"flex",alignItems:"center",gap:10,margin:"16px 0"}}>
        <div style={{height:1,background:"#1e1e1e",flex:1}}/>
        <div style={{fontSize:10,color:"#555",letterSpacing:2,textTransform:"uppercase"}}>or continue</div>
        <div style={{height:1,background:"#1e1e1e",flex:1}}/>
      </div>
      {requiresShipping && (
        <div style={{marginBottom:18}}>
          <div style={{fontSize:10,color:"#777",letterSpacing:2,textTransform:"uppercase",marginBottom:10}}>Shipping Details</div>
          <AddressElement options={{mode:"shipping",fields:{phone:"always"},validation:{phone:{required:"always"}}}}/>
        </div>
      )}
      <PaymentElement options={{layout:"tabs"}}/>
      <button type="submit" disabled={!stripe||loading} style={{marginTop:20,width:"100%",padding:12,background:"#00ffff",color:"#000",fontWeight:"bold",border:"none",borderRadius:8,cursor:"pointer"}}>{loading?"Processing…":submitLabel}</button>
      {error && <p style={{color:"#ff4d4d",fontSize:12,marginTop:10}}>{error}</p>}
    </form>
  );
}

export default memo(CheckoutForm);
