async function bounded(promise, label) {
    let timer;
    try {
        return await Promise.race([promise, new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error(`Timed out waiting for ${label}`)), 15000);
        })]);
    } finally { clearTimeout(timer); }
}

// Capture an actual native response, then delay its delivery to the mounted view.
export async function holdNativeResponse(page, path, method = 'GET') {
    let release, received, delivered;
    const gate = new Promise(resolve => { release = resolve; });
    const responseReady = new Promise(resolve => { received = resolve; });
    const deliveryDone = new Promise(resolve => { delivered = resolve; });
    let first = true;
    const handler = async route => {
        if (!first || route.request().method() !== method) return route.continue();
        first = false;
        const response = await route.fetch();
        received(response);
        await gate;
        try { await route.fulfill({response}); }
        finally { delivered(); }
    };
    await page.route('**' + path, handler);
    return {
        get responseReady() { return bounded(responseReady, `${method} ${path} native response`); },
        get deliveryDone() { return bounded(deliveryDone, `${method} ${path} delivery`); },
        release,
        close: async () => { release(); await page.unroute('**' + path, handler); },
    };
}
