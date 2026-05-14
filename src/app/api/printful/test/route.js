export async function GET() {
  const res = await fetch("https://api.printful.com/store", {
    headers: {
      Authorization: `Bearer ${process.env.PRINTFUL_API_KEY}`,
    },
  });

  const data = await res.json();

  return Response.json({
    success: true,
    data,
  });
}