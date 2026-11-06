let transport = () => Promise.reject(new Error('Helios transport is not installed'));
export const heliosFetch = request => transport(request);
export function setHeliosFetch(fetch) { transport = fetch; }
