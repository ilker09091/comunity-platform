export const THEME_KEY = "circle-theme";
/**
 * Runs inline in <head> before the first paint (see layout.js), so the page never flashes the
 * wrong theme. Dependency-free; mirrors `resolve` in theme.ts.
 */
export const THEME_BOOT_SCRIPT = `(function(){try{var p=localStorage.getItem("${THEME_KEY}");var d=p==="dark"||(p!=="light"&&matchMedia("(prefers-color-scheme: dark)").matches);var r=document.documentElement;r.dataset.theme=d?"dark":"light";r.style.colorScheme=d?"dark":"light";}catch(e){}})();`;
