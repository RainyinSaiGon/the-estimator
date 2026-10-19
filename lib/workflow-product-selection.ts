/** An unknown or retired catalog ID must be represented by the Unknown option. */
export function configuredProductId(productId: string, products: ReadonlyArray<{ id: string }>): string {
  return products.some(product => product.id === productId) ? productId : "";
}
