export async function GET() {
  try {
    const res = await fetch("https://api.printful.com/store/products", {
      headers: {
        Authorization: `Bearer ${process.env.PRINTFUL_API_KEY}`,
      },
    });

    const data = await res.json();

    const products = (data.result || []).map((p) => ({
      id: p.id,
      name: p.name,
      thumbnail: p.thumbnail_url,
    }));

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