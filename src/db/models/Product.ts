import mongoose from 'mongoose';

const productSchema = new mongoose.Schema({
    id: { type: String, required: true, unique: true },
    name: { type: String, required: true },
    price: { type: Number, required: true },
    sku: { type: String, required: true, unique: true },
}, { timestamps: true });

export const Product = mongoose.model('Product', productSchema);
