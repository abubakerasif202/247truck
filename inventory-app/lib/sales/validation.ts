import { z } from 'zod';

const quantity = z.string().trim().regex(/^\d+(?:\.\d{1,3})?$/, 'Enter a positive quantity').refine((value) => Number(value) > 0, 'Enter a positive quantity');
const price = z.string().trim().regex(/^\d+(?:\.\d{1,2})?$/, 'Enter a valid GST-inclusive price');

export const salesLineSchema = z.object({
  lineType: z.enum(['product', 'labour']),
  productId: z.uuid().nullable(),
  description: z.string().trim().min(1, 'Description is required').max(500),
  quantity,
  unitPriceInclGst: price.nullable(),
}).superRefine((line, context) => {
  if (line.lineType === 'product') {
    if (!line.productId) context.addIssue({ code: 'custom', path: ['productId'], message: 'Choose a product' });
    if (!Number.isInteger(Number(line.quantity))) context.addIssue({ code: 'custom', path: ['quantity'], message: 'Product quantity must be a whole number' });
  } else {
    if (line.productId) context.addIssue({ code: 'custom', path: ['productId'], message: 'Labour cannot reference a product' });
    if (line.unitPriceInclGst === null) context.addIssue({ code: 'custom', path: ['unitPriceInclGst'], message: 'Labour price is required' });
  }
});
