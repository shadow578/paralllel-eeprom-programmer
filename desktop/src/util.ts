export function sleep(ms: number) {
    return new Promise(r => setTimeout(r, ms));
}


export function yieldThread() {
    //NOTE: in case setImmediate is unstable, replace with sleep(1)
    //return sleep(1);
    return new Promise(r => setImmediate(r));
}

export function millis() {
    return performance.now();
}

export async function withRetry<T>(retries: number, callback: () => T): Promise<T> {
    let lastError;
    for (let tries = 0; tries < retries; tries++) {
        try {
            return await callback();
        } catch (error) {
            //console.log(error);
            lastError = error;
        }
    }

    throw lastError;
}