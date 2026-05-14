export async function GET() {
  try {
    const res = await fetch("https://api.printful.com/store/products", {
      headers: {
        Authorization: `Bearer ${process.env.PRINTFUL_API_KEY}`,
      },
    });

    const data = await res.json();

 const result = data.result;

// normalize safely
let products = [];

if (Array.isArray(result)) {
  products = result;
} else if (Array.isArray(result?.sync_products)) {
  products = result.sync_products;
} else if (Array.isArray(result?.items)) {
  products = result.items;
} else {
  products = [];
}

return Response.json({
  success: true,
  products
});

    return Response.json({
      success: true,
      products,
    });
  } catch (err) {
    return Response.json({
      success: false,
      error: err.message,
    });
  }
}