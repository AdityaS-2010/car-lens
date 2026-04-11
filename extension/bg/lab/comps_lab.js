// bg/lab/comps_lab.js
// Debug-only comparable listings harness. This intentionally bypasses Gemini
// and the report fetch so scraper/injection work can be tested in isolation.

async function handleFetchComparablePricesLab(payload) {
  var car = payload || {};
  console.log("[CarLens Comps Lab] Input:", JSON.stringify(car));

  var result = await handleFetchComparablePrices(
    car.make,
    car.model,
    car.year,
    car.location,
    car.price,
    car.mileage,
    car.vin,
    car.trim,
    {
      crawlAllPages: true,
      labMode: true,
      maxPages: 10,
      minListingsBeforeStop: 9999,
    }
  );

  console.log("[CarLens Comps Lab] Result:", JSON.stringify(result));
  return {
    input: car,
    result: result,
  };
}
