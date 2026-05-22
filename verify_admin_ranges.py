import asyncio
from playwright.async_api import async_playwright
import os

async def verify_admin_ranges():
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        context = await browser.new_context()
        page = await context.new_page()

        # Login
        await page.goto("http://localhost:3000/admin")
        await page.fill('input[type="password"]', 'password')
        await page.click('button:has-text("Sign in")')
        await page.wait_for_selector('text=Admin Panel')

        # Go to Meeting Types
        await page.click('button:has-text("Meeting Types")')

        # Expand first meeting type
        await page.click('text=Details', index=0)

        # Take screenshot of the expanded meeting type with date overrides
        await page.screenshot(path="/home/jules/verification/admin_mt_overrides.png")

        # Test adding a date
        # Note: Interacting with DatePicker via Playwright can be tricky,
        # but we can try to fill the input or click.
        # For now, just seeing it rendered is good.

        await browser.close()

if __name__ == "__main__":
    if not os.path.exists("/home/jules/verification"):
        os.makedirs("/home/jules/verification")
    asyncio.run(verify_admin_ranges())
