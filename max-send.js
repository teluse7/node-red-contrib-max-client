module.exports = function (RED) {
    const puppeteer = require('puppeteer');

    function MaxClientNode(config) {
        RED.nodes.createNode(this, config);
        
        this.url = config.url;
        this.userid = config.userid;
        this.scrshot = config.scrshot;
        this.canvasctrl = config.canvasctrl;
        this.serviceurl = config.serviceurl;

        let node = this;
        
        node.on('input', async function(msg) {
            let url = node.url;
            let userid = node.userid;
            let token = node.credentials.token;
            let scrshot = node.scrshot;
            let canvasctrl = node.canvasctrl;
            let serviceurl = node.serviceurl; 
            let fillColor;

            const attach = scrshot ? (            
                await msg.payload.match(/https?:\/\/[^\s]+/g)?.map((iUrl,i) =>   
                   fetch(url + '/uploads?type=image', {
                       method: 'POST',
                       headers: {
                           'Authorization': token
                       }
                   })
                       .then (response => response.json())
                       .then (data =>  
                           makeScreen(serviceurl, iUrl,canvasctrl) 
                               .then (image => {
                                   const formData = new FormData();
                                   formData.append("data", new File([image], 'screen' + i + '.jpeg', { type: 'image/jpeg' }));
              
                                   return fetch(data.url, {
                                       method: 'POST',
                                       body: formData,
                                       headers: {
                                           'Authorization': token
                                       }
                                   })
                                       .then (iresponse => iresponse.json())
                                       .then (idata => ({ type: "image", payload: idata }))
                                       .catch (error => node.status({ fill: fillColor = "red", shape: "ring", text: 'max-send.status.ierror' }))
                               })
                               .catch (error => {
                                   node.log(error.message);
                                   node.status({ fill: fillColor = "red", shape: "ring", text: 'max-send.status.serror' })
                               })
                       )
                       .catch (error => node.status({ fill: fillColor = "red", shape: "ring", text: 'max-send.status.lerror' }))
                ) || []
            ) : [];

           
            Promise.all(attach)
                .then (value => 
                    fetch(url + '/messages?user_id=' + userid.match(/^(?:\+)?([a-zA-Z0-9а-яА-Я_-]{1,6})/)[1], {
                        method: 'POST',
                        headers: { 
                            'Content-Type': 'application/json',
                            'Authorization': token
                        },
                        body: JSON.stringify({ 
                            text: msg.payload,
                            ...(value[0]?.payload?.photos ? { attachments: value } : {})
                        })
                    })
                        .then(response => 
                            fillColor ?? (response.ok
                                ? node.status({ fill: "green", shape: "dot", text: RED._('max-send.status.send') + userid })
                                : node.status({ fill: "red", shape: "ring", text: 'max-send.status.' + response.status })
                            )   
                        )                           
                        .catch (error => 
                            fillColor ?? (error.message == 'fetch failed'           
                                ? node.status({ fill: "red", shape: "ring", text: RED._('max-send.status.error') + url })
                                : node.status({ fill: "red", shape: "ring", text: error.message })
                            )
                        )
                );

            node.send(msg);
        });

        async function makeScreen(serviceUrl, link, ctrl) {
            if(!serviceUrl || serviceUrl.trim() === '')
                return await localScreenshot(link, ctrl);
            return await getScreenshot(serviceUrl, link, ctrl)
        }

        async function localScreenshot(link, ctrl) {
            const mobilePhone = puppeteer.devices['iPhone 13'];
            const browser = await puppeteer.launch();
            const page = await browser.newPage();
            await page.emulateTimezone(process.env.TZ || 'Europe/Moscow');
            await page.emulate(mobilePhone, { 
                width: 1440, 
                height: 2822 
            });

            await page.goto(link, { 
                waitUntil: ['domcontentloaded'],
                timeout: 40000  
            });

            const currentUrl = new URL(page.url());
            if (currentUrl.hostname.includes('bitly.com') || currentUrl.hostname.includes('bit.ly')) 
                await handleBitlyRedirect(page);

            await page.waitForFunction(() => {
                if (!window.__urlCheck) window.__urlCheck = { last: location.href, count: 0, stable: false };
                const current = location.href;
                if (current === window.__urlCheck.last) 
                    window.__urlCheck.count++
                else {
                    window.__urlCheck.last = current;
                    window.__urlCheck.count = 0;
                }
    
                window.__urlCheck.stable = window.__urlCheck.count >= 3;
                return window.__urlCheck.stable;
            }, { timeout: 30000, polling: 1000 });


            if (ctrl) {
                await page.waitForSelector('canvas', { visible: true, timeout: 40000 });
                await page.waitForFunction(() => {
                    for (const c of document.querySelectorAll('canvas')) 
                        try {
                            if (!(c.getContext('2d')?.getImageData(0, 0, c.width, c.height).data.some((v, i) => i % 4 === 3 && v > 0) ?? true)) 
                                return false
                        } catch (e) {
                            return false
                        }
                    return true
                }, { timeout: 40000, polling: 500 });
              
                await page.evaluate(() => {
                    return new Promise(resolve => {
                        requestAnimationFrame(() => {
                            requestAnimationFrame(() => resolve());
                        })
                    })
                }) 
            };

            const screenshotBuffer = await page.screenshot({
                type: 'jpeg',
                quality: 100
            });
            await browser.close();
            return screenshotBuffer;
        }

        async function getScreenshot(serviceUrl, link, ctrl) {
            const params = new URLSearchParams({ url: link, delay: String(ctrl) });
            const res = await fetch(`${serviceUrl}?${params.toString()}`);
            if (!res.ok) 
                throw new Error(`Screenshot service error: ${res.status} ${res.statusText}`);
            return Buffer.from(await res.arrayBuffer());
        }

        async function handleBitlyRedirect(page) {
            const timeoutMs = 12000; 
            const start = Date.now();
        
            const hasButtonPromise = page.waitForFunction(
                () => {
                    const btn = Array.from(document.querySelectorAll('button, a'))
                        .find(el => (el.innerText || '').includes('Continue to destination'));
                    return !!btn
                },
                { timeout: timeoutMs }
            );
        
            const urlChangedPromise = new Promise((resolve, reject) => {
                const initialUrl = page.url();
                const check = setInterval(async () => {
                    if (Date.now() - start > timeoutMs) {
                        clearInterval(check);
                        reject(new Error('Timeout'))
                    }
                    try {
                        const currentUrl = await page.url();
                        if (currentUrl !== initialUrl) {
                            clearInterval(check);
                            resolve(currentUrl)
                        }
                    } catch (e) {
                        clearInterval(check);
                        reject(e)
                    }
                }, 500)
            });
        
            try {
                await Promise.race([hasButtonPromise, urlChangedPromise])
            } catch (e) {
                return
            }
        
            const btnExists = await page.evaluate(() => {
                const btn = Array.from(document.querySelectorAll('button, a'))
                    .find(el => (el.innerText || '').includes('Continue to destination'));
                return !!btn
            });
        
            if (btnExists) {
                await page.evaluate(() => {
                    const btn = Array.from(document.querySelectorAll('button, a'))
                        .find(el => (el.innerText || '').includes('Continue to destination'));
                    if (btn) btn.click()
                });
        
                await Promise.race([
                    page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 20000 }),
                    new Promise(r => setTimeout(r, 20000))
                ]);
        
                await new Promise(r => setTimeout(r, 2000)) 
            }
        }
    }

    RED.nodes.registerType("max-send", MaxClientNode, {
        credentials: {
            token: { type: 'text' }
        }
    });
}