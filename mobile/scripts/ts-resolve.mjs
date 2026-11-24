/**
 * Node's type stripping runs `.ts` files as ES modules, and ES module
 * resolution does not add a `.ts` suffix. App code uses extensionless imports
 * (Metro resolves them), so the unit scripts register this hook to resolve the
 * same specifiers the bundler would.
 */
export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('.') && !/\.[cm]?[jt]sx?$/.test(specifier)) {
    try {
      return await nextResolve(`${specifier}.ts`, context);
    } catch {
      // Fall through to the default resolution and let Node report it.
    }
  }
  return nextResolve(specifier, context);
}
