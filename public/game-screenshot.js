const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({
    headless: true,
    args: [
      '--start-maximized',
      '--window-position=0,0',
      '--window-size=3840,2160',
      '--enable-gpu', 
      '--mute-audio',
      '--disable-softare-rasterized'
    ]
  });

  const context = await browser.newContext({
    storageState: 'storageState.json',
    viewport: { width: 3840, height: 2160 },
    deviceScaleFactor: 2 // pixel density
  });

  const page = await context.newPage();
  await page.goto('https://www.gtarcade.com/404.html');

  await page.getByRole('banner')
    .getByRole('link', { name: 'Game', exact: true })
    .click();

  const popup1Promise = page.waitForEvent('popup');
  await page.getByRole('link', {
    name: 'Game of Thrones Winter is Coming Game of Thrones Winter is Coming'
  }).click();
  const page1 = await popup1Promise;
  if (!page1) throw new Error('First popup did not open!');

  const popup2Promise = page1.waitForEvent('popup');
  await page1.locator('#joinBtn').click();
  const page3 = await popup2Promise;
  if (!page3) throw new Error('Second popup did not open!');

  await page3.waitForTimeout(8000);

  const allFrames = page3.frames();

  const canvasSelector = '#unity-canvas';
  let targetFrame = null;
  for (const f of allFrames) {
    try {
      await f.waitForSelector(canvasSelector, { timeout: 5000 });
      targetFrame = f;
      break;
    } catch {}
  }

  if (!targetFrame) {
    console.error(`Never found ${canvasSelector} in any frame!`);
    return;
  }

  const clipRegion = {
    x: 1050,
    y: 640,
    width: 2880 - 1050,
    height: 1745 - 640
  };

  const clickActions = [
    { x: 3700, y: 1800, delay: 2000 },
    { x: 3700, y: 1800, delay: 2500 },
    { x: 2730, y: 2021, delay: 3000 },
    { x: 2340, y: 1550, delay: 1500 },
    { x: 2060, y: 475, delay: 3500 },
  ];

  for (const { x, y, delay } of clickActions) {
    console.log(`Clicking ${canvasSelector} at (${x}, ${y}), then waiting ${delay}ms`);
    await targetFrame.click(canvasSelector, { position: { x, y } });
    await targetFrame.waitForTimeout(delay);
  }

  // Take one initial screenshot before moving out of the iframe
  await page3.screenshot({
    path: `partial_screenshot_0.png`,
    clip: clipRegion
  });
  console.log(`Initial partial screenshot before drag taken.`);

  for (let i = 1; i <= 6; i++) {
    // Click outside to gain focus first
    await page3.mouse.click(1800, 1100);
    await page3.waitForTimeout(500);

    // Click into the iframe again
    await targetFrame.click(canvasSelector, { position: { x: 1800, y: 1100 } });
    await page3.waitForTimeout(1000);

    // Click and hold, then move cursor while holding
    const mouse = page3.mouse;
    await mouse.move(1480, 1732);
    await mouse.down(); // Click and hold
    await page3.waitForTimeout(500);
    await mouse.move(1480, 670, { steps: 10 });
    await page3.waitForTimeout(1000);
    await mouse.up(); // Release click
    await page3.waitForTimeout(1000);

    // Take a screenshot after ensuring all actions are complete
    await page3.screenshot({
      path: `partial_screenshot_${i}.png`,
      clip: clipRegion
    });
    console.log(`Partial screenshot ${i} after drag taken.`);
  }

  // console.log('Script completed, keeping browser open.');
  console.log('Script finished, closing browser')
  browser.close();
})();
