export async function GET() {
  try {
    const res = await fetch("https://api.printful.com/store/products", {
      headers: {
        Authorization: `Bearer ${process.env.PRINTFUL_API_KEY}`,
      },
    });

    const data = await res.json();

    console.log("PRINTFUL RAW:", data);

    // SAFELY normalize result
    let rawProducts = [];

    if (Array.isArray(data.result)) {
      rawProducts = data.result;
    } else if (Array.isArray(data.result?.items)) {
      rawProducts = data.result.items;
    } else if (Array.isArray(data.result?.products)) {
      rawProducts = data.result.products;
    }

    const products = rawProducts.map((item) => ({
      id: item.id,
      title: item.name || item.sync_product?.name || "Product",
      cover:
        item.thumbnail_url ||
        item.sync_product?.thumbnail_url ||
        "",
      price:
        item.retail_price ||
        item.sync_variants?.[0]?.retail_price ||
        0,
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