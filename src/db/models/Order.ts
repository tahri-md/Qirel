import mongoose from 'mongoose';

const orderSchema = new mongoose.Schema({
    id: { type: String, required: true, unique: true },
    userId: { type: String, required: true },
    total: { type: Number, required: true },
    status: { type: String, required: true },
}, { timestamps: true });

export const Order = mongoose.model('Order', orderSchema);
