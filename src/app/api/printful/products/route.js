export async function GET() {
  try {
    const res = await fetch("https://api.printful.com/store/products", {
      headers: {
        Authorization: `Bearer ${process.env.PRINTFUL_API_KEY}`,
      },
    });

    const data = await res.json();

    console.log("PRINTFUL RAW:", data);

    const rawProducts = data.result || [];

    const products = rawProducts.map((item) => ({
      id: item.id,
      title: item.name,
      cover: item.thumbnail_url,
      price: item.retail_price || 0,
    }));

    return Response.json({
      success: true,
      products,
    });

  } catch (err) {
    return Response.json({
      success: false,
      error: err.message,
      products: [],
    });
  }
}