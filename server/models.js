const mongoose = require('mongoose');

// User Schema
const userSchema = new mongoose.Schema({
    username: { type: String, required: true, unique: true },
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    subscriptions: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Subscription' }],
}, { timestamps: true });

// Script Schema
const scriptSchema = new mongoose.Schema({
    title: { type: String, required: true },
    content: { type: String, required: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

// Subscription Schema
const subscriptionSchema = new mongoose.Schema({
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    script: { type: mongoose.Schema.Types.ObjectId, ref: 'Script' },
    subscriptionDate: { type: Date, default: Date.now },
}, { timestamps: true });

// Payment Schema
const paymentSchema = new mongoose.Schema({
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    amount: { type: Number, required: true },
    paymentDate: { type: Date, default: Date.now },
}, { timestamps: true });

// Exporting Models
const User = mongoose.model('User', userSchema);
const Script = mongoose.model('Script', scriptSchema);
const Subscription = mongoose.model('Subscription', subscriptionSchema);
const Payment = mongoose.model('Payment', paymentSchema);

module.exports = { User, Script, Subscription, Payment };