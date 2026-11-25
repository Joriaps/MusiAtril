// child-src: workers en Safari 10. worker-src y manifest-src: navegadores modernos.
export const CSP = "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; connect-src 'self'; child-src 'self'; worker-src 'self'; font-src 'none'; object-src 'none'; manifest-src 'self'; base-uri 'none'; form-action 'none'";
