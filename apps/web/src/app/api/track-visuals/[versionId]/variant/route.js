import { visualDelivery } from '@/lib/track-visuals/delivery';
export const dynamic = 'force-dynamic';
export const GET = (req, context) => visualDelivery(req, context, 'variant');
