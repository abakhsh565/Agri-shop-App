// Custom ESM loader that transforms import.meta.env in all source files
// The env values are set on globalThis.__viteEnv by the caller before this loads.

export async function resolve(specifier, context, nextResolve) {
  return nextResolve(specifier, context);
}

export async function load(url, context, nextLoad) {
  const result = await nextLoad(url, context);
  
  // Transform any .ts/.tsx file that uses import.meta.env
  if ((url.endsWith(".ts") || url.endsWith(".tsx")) && result.format === "module") {
    let source = typeof result.source === "string" 
      ? result.source 
      : new TextDecoder().decode(result.source);
    
    if (source.includes("import.meta.env")) {
      source = source.replace(
        /import\.meta\.env/g,
        "globalThis.__viteEnv"
      );
      
      return {
        format: "module",
        source: source,
        shortCircuit: true,
      };
    }
  }
  
  return result;
}
