/**
 * JSPM Client-Side Printing Implementation
 *
 * Usage:
 * <script src="/public/js/printer-client.js"></script>
 * await PrinterClient.init()
 */

const PrinterClient = (() => {
    let selectedPrinter = null;
    let isConnected = false;
    const STORAGE_KEY = 'printer_preference';

    function hasJSPM() {
        return typeof window.JSPM !== 'undefined' && window.JSPM.JSPrintManager;
    }

    function wait(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = String(text ?? '');
        return div.innerHTML;
    }

    async function loadScriptFrom(src) {
        return new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = src;
            script.async = true;
            script.onload = () => resolve(true);
            script.onerror = () => reject(new Error(`Failed: ${src}`));
            document.head.appendChild(script);
        });
    }

    async function loadJSPMLibrary() {
        if (hasJSPM()) {
            return true;
        }

        // Local-first strategy for localhost/offline usage.
        const candidates = [
            '/public/vendor/jspm/JSPrintManager.js',
            '/JSPrintManager.js',
            'https://jsprintmanager.azurewebsites.net/scripts/JSPrintManager.js'
        ];

        for (const src of candidates) {
            try {
                await loadScriptFrom(src);
                if (hasJSPM()) {
                    return true;
                }
            } catch (err) {
                // Continue trying next source.
            }
        }

        throw new Error(
            'JSPrintManager.js could not be loaded. Put file at /public/vendor/jspm/JSPrintManager.js or allow access to https://jsprintmanager.azurewebsites.net/scripts/JSPrintManager.js'
        );
    }

    async function connectToService(timeoutMs = 8000) {
        if (!hasJSPM()) {
            throw new Error('JSPM library is not loaded.');
        }

        const manager = window.JSPM.JSPrintManager;
        manager.auto_reconnect = true;
        manager.start();

        const startedAt = Date.now();
        while (Date.now() - startedAt < timeoutMs) {
            if (manager.websocket_status === window.JSPM.WSStatus.Open) {
                isConnected = true;
                return true;
            }
            if (manager.websocket_status === window.JSPM.WSStatus.Blocked) {
                throw new Error('JSPM blocked this website. Allow this origin in JSPrintManager settings.');
            }
            await wait(150);
        }

        isConnected = false;
        return false;
    }

    async function init() {
        await loadJSPMLibrary();
        const ok = await connectToService();
        if (ok) {
            restorePrinterPreference();
        }
        return ok;
    }

    async function getAvailablePrinters() {
        if (!isConnected) {
            const ok = await connectToService();
            if (!ok) {
                throw new Error('Could not connect to JSPrintManager service.');
            }
        }

        const raw = await window.JSPM.JSPrintManager.getPrinters();
        const printers = (raw || []).map((p) => {
            if (typeof p === 'string') {
                return { name: p };
            }
            return { name: p?.name || String(p) };
        });

        if (!printers.length) {
            throw new Error('No printers found on this machine.');
        }

        return printers;
    }

    function selectPrinter(printerName) {
        selectedPrinter = String(printerName || '').trim() || null;
        if (selectedPrinter) {
            localStorage.setItem(STORAGE_KEY, selectedPrinter);
        }
    }

    function restorePrinterPreference() {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved) {
            selectedPrinter = saved;
        }
    }

    async function getPrinterStatus(printerName) {
        // JSPM v8 does not expose a simple universal status call like some wrappers.
        // Return a lightweight status object for compatibility with existing UI code.
        const name = String(printerName || '').trim();
        return {
            isOnline: !!name,
            printerName: name
        };
    }

    async function getTsplFromBackend(productId, quantity = 1) {
        const response = await fetch(`/print/generate-barcode?product_id=${productId}&quantity=${quantity}`);
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        const data = await response.json();
        if (!data.success) {
            throw new Error(data.message || 'Failed to generate TSPL');
        }

        return data;
    }

    async function sendRawToInstalledPrinter(printerName, rawData) {
        if (!isConnected) {
            const ok = await connectToService();
            if (!ok) {
                throw new Error('Could not connect to JSPrintManager service.');
            }
        }

        const cpj = new window.JSPM.ClientPrintJob();
        cpj.clientPrinter = new window.JSPM.InstalledPrinter(printerName);
        cpj.printerCommands = String(rawData || '');
        cpj.sendToClient();

        // JSPM sendToClient does not return a promise for completion in this basic flow.
        return { success: true, message: `Print job sent to ${escapeHtml(printerName)}` };
    }

    async function printBarcode(productId, quantity = 1, printerName = null) {
        const printer = (printerName || selectedPrinter || '').trim();
        if (!printer) {
            throw new Error('No printer selected.');
        }

        const data = await getTsplFromBackend(productId, quantity);
        return sendRawToInstalledPrinter(printer, data.tspl);
    }

    async function reconnect() {
        isConnected = false;
        return connectToService();
    }

    return {
        init,
        getAvailablePrinters,
        selectPrinter,
        getSelectedPrinter: () => selectedPrinter,
        getPrinterStatus,
        printBarcode,
        getTsplFromBackend,
        isConnectedToJSPM: () => isConnected,
        reconnect
    };
})();
