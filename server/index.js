require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const Stripe = require('stripe');
const Anthropic = require('@anthropic-ai/sdk');
const app = express();

app.use(express.json());
app.use(cors());

mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/scriptforge', {useNewUrlParser: true, useUnifiedTopology: true}).then(() => console.log('✓ MongoDB Connected')).catch(err => console.error('MongoDB Error:', err));

const userSchema = new mongoose.Schema({firstName: String, lastName: String, email: { type: String, unique: true, required: true }, password: { type: String, required: true }, plan: { type: String, enum: ['starter', 'creator', 'studio'], default: 'starter' }, scriptsUsed: { type: Number, default: 0 }, scriptsLimit: { type: Number, default: 5 }, stripeCustomerId: String, stripeSubscriptionId: String, createdAt: { type: Date, default: Date.now }, updatedAt: { type: Date, default: Date.now }});

const scriptSchema = new mongoose.Schema({userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }, title: String, topic: String, hook: String, intro: String, sections: [{ heading: String, content: String }], cta: String, outro: String, hookOptions: [String], titles: [String], thumbnailIdea: String, format: String, audience: String, tone: Number, createdAt: { type: Date, default: Date.now }});

const User = mongoose.model('User', userSchema);
const Script = mongoose.model('Script', scriptSchema);

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const client = new Anthropic();

const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'No token provided' });
    jwt.verify(token, process.env.JWT_SECRET || 'your_secret_key', (err, user) => {
        if (err) return res.status(403).json({ error: 'Invalid token' });
        req.user = user;
        next();
    });
};

app.post('/api/auth/signup', async (req, res) => {
    try {
        const { firstName, lastName, email, password, plan = 'creator' } = req.body;
        const existingUser = await User.findOne({ email });
        if (existingUser) return res.status(400).json({ error: 'Email already exists' });

        const hashedPassword = await bcrypt.hash(password, 10);
        const newUser = new User({firstName, lastName, email, password: hashedPassword, plan, scriptsLimit: plan === 'starter' ? 5 : Infinity});
        await newUser.save();

        const token = jwt.sign({ id: newUser._id, email: newUser.email, plan: newUser.plan }, process.env.JWT_SECRET || 'your_secret_key', { expiresIn: '30d' });
        res.status(201).json({token, user: {id: newUser._id, firstName: newUser.firstName, email: newUser.email, plan: newUser.plan}});
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/auth/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        const user = await User.findOne({ email });
        if (!user) return res.status(404).json({ error: 'User not found' });

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) return res.status(401).json({ error: 'Invalid credentials' });

        const token = jwt.sign({ id: user._id, email: user.email, plan: user.plan }, process.env.JWT_SECRET || 'your_secret_key', { expiresIn: '30d' });
        res.json({token, user: {id: user._id, firstName: user.firstName, email: user.email, plan: user.plan, scriptsUsed: user.scriptsUsed, scriptsLimit: user.scriptsLimit}});
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/scripts/generate', authenticateToken, async (req, res) => {
    try {
        const { topic, format, audience, length, tone, context } = req.body;
        const user = await User.findById(req.user.id);

        if (user.scriptsUsed >= user.scriptsLimit && user.plan === 'starter') {
            return res.status(403).json({ error: 'Script limit reached. Upgrade to continue.' });
        }

        const toneDescriptions = ['calm & informative', 'conversational', 'balanced', 'energetic', 'high-octane viral'];
        const toneDesc = toneDescriptions[tone - 1] || 'balanced';
        const prompt = `You are a world-class YouTube scriptwriter. Return ONLY valid JSON with no markdown: {"hook": "2-3 sentence opening that stops scrollers cold", "hook_options": ["hook 1", "hook 2", "hook 3"], "intro": "2-3 sentences after hook setting up the promise", "sections": [{"heading": "section 1 title", "content": "4-6 sentences of vivid script content"},{"heading": "section 2 title", "content": "4-6 sentences of vivid script content"},{"heading": "section 3 title", "content": "4-6 sentences of vivid script content"},{"heading": "section 4 title", "content": "4-6 sentences of vivid script content"},{"heading": "section 5 title", "content": "4-6 sentences of vivid script content"}], "cta": "2 compelling sentences for subscribe/comment", "outro": "warm closing line", "titles": ["title 1", "title 2", "title 3", "title 4", "title 5"], "thumbnail_idea": "one concrete thumbnail sentence with visual description"} Topic: ${topic} Format: ${format} Audience: ${audience} Length: ${length} Tone: ${toneDesc} ${context ? `Context: ${context}` : ''} Write exactly 5 sections minimum. Make hooks genuinely arresting. Titles must use proven YouTube patterns.`;

        const message = await client.messages.create({model: 'claude-3-5-sonnet-20241022', max_tokens: 4000, messages: [{ role: 'user', content: prompt }]});

        const responseText = message.content[0].text;
        const jsonMatch = responseText.match(/\{[\s\S]*\}/);
        if (!jsonMatch) throw new Error('Could not parse Claude response');

        const scriptData = JSON.parse(jsonMatch[0]);
        const script = new Script({userId: req.user.id, title: scriptData.titles[0], topic, hook: scriptData.hook, intro: scriptData.intro, sections: scriptData.sections || [], cta: scriptData.cta, outro: scriptData.outro, hookOptions: scriptData.hook_options || [scriptData.hook], titles: scriptData.titles || [], thumbnailIdea: scriptData.thumbnail_idea, format, audience, tone});

        await script.save();
        user.scriptsUsed += 1;
        await user.save();
        res.json({script: {id: script._id, ...scriptData}, scriptsRemaining: user.scriptsLimit - user.scriptsUsed});
    } catch (error) {
        console.error('Script generation error:', error);
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/scripts', authenticateToken, async (req, res) => {
    try {
        const scripts = await Script.find({ userId: req.user.id }).sort({ createdAt: -1 });
        res.json(scripts);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/scripts/:id', authenticateToken, async (req, res) => {
    try {
        const script = await Script.findById(req.params.id);
        if (!script) return res.status(404).json({ error: 'Script not found' });
        if (script.userId.toString() !== req.user.id) return res.status(403).json({ error: 'Unauthorized' });
        res.json(script);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.delete('/api/scripts/:id', authenticateToken, async (req, res) => {
    try {
        const script = await Script.findById(req.params.id);
        if (!script) return res.status(404).json({ error: 'Script not found' });
        if (script.userId.toString() !== req.user.id) return res.status(403).json({ error: 'Unauthorized' });
        await Script.findByIdAndDelete(req.params.id);
        res.json({ message: 'Script deleted' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/analyzer/analyze', authenticateToken, async (req, res) => {
    try {
        const { url } = req.body;
        const user = await User.findById(req.user.id);
        if (user.plan !== 'creator' && user.plan !== 'studio') {
            return res.status(403).json({ error: 'Feature available for Creator+ plans only' });
        }

        const prompt = `Analyze this YouTube video URL: ${url} Return ONLY valid JSON: {"video_title": "actual title", "channel": "channel name", "topic": "main topic for your own version", "format": "listicle|documentary|tutorial|review|story|educational", "audience": "target audience description", "key_angles": ["angle 1", "angle 2", "angle 3"], "hook_insight": "why this hook works", "improvement": "best way to differentiate your version", "suggested_title": "improved title variant"}`;

        const message = await client.messages.create({model: 'claude-3-5-sonnet-20241022', max_tokens: 2000, messages: [{ role: 'user', content: prompt }]});

        const responseText = message.content[0].text;
        const jsonMatch = responseText.match(/\{[\s\S]*\}/);
        if (!jsonMatch) throw new Error('Could not parse analysis');

        const analysis = JSON.parse(jsonMatch[0]);
        res.json(analysis);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/titles/generate', authenticateToken, async (req, res) => {
    try {
        const { topic, styles, niche } = req.body;
        const prompt = `Generate exactly 10 YouTube video titles for: ${topic} Niche: ${niche} Styles: ${styles.join(', ')} Return ONLY a JSON array with no markdown: ["title1", "title2", "title3", "title4", "title5", "title6", "title7", "title8", "title9", "title10"] Make them click-worthy, specific, using numbers, curiosity gaps, transformation, controversy. No generic titles.`;

        const message = await client.messages.create({model: 'claude-3-5-sonnet-20241022', max_tokens: 800, messages: [{ role: 'user', content: prompt }]});

        const responseText = message.content[0].text;
        const jsonMatch = responseText.match(/\[[\s\S]*\]/);
        if (!jsonMatch) throw new Error('Could not parse titles');

        const titles = JSON.parse(jsonMatch[0]);
        res.json({ titles });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/payments/checkout', authenticateToken, async (req, res) => {
    try {
        const { plan } = req.body;
        const user = await User.findById(req.user.id);
        const plans = {starter: { priceId: process.env.STRIPE_PRICE_STARTER, name: 'Starter' }, creator: { priceId: process.env.STRIPE_PRICE_CREATOR, name: 'Creator' }, studio: { priceId: process.env.STRIPE_PRICE_STUDIO, name: 'Studio' }};

        if (!plans[plan]) return res.status(400).json({ error: 'Invalid plan' });

        const session = await stripe.checkout.sessions.create({customer_email: user.email, payment_method_types: ['card'], line_items: [{price: plans[plan].priceId, quantity: 1}], mode: 'subscription', success_url: `${process.env.FRONTEND_URL}/dashboard?session_id={CHECKOUT_SESSION_ID}`, cancel_url: `${process.env.FRONTEND_URL}/pricing`, metadata: { userId: user._id.toString(), plan }});
        res.json({ sessionId: session.id });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/payments/webhook', express.raw({type: 'application/json'}), async (req, res) => {
    const sig = req.headers['stripe-signature'];
    try {
        const event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);

        if (event.type === 'checkout.session.completed') {
            const session = event.data.object;
            const userId = session.metadata.userId;
            const plan = session.metadata.plan;

            await User.findByIdAndUpdate(userId, {plan, stripeCustomerId: session.customer, stripeSubscriptionId: session.subscription, scriptsUsed: 0, scriptsLimit: plan === 'starter' ? 5 : Infinity});
        }
        res.json({ received: true });
    } catch (error) {
        res.status(400).send(`Webhook Error: ${error.message}`);
    }
});

app.get('/api/user/profile', authenticateToken, async (req, res) => {
    try {
        const user = await User.findById(req.user.id).select('-password');
        res.json(user);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.put('/api/user/profile', authenticateToken, async (req, res) => {
    try {
        const { firstName, lastName } = req.body;
        const user = await User.findByIdAndUpdate(req.user.id, { firstName, lastName, updatedAt: new Date() }, { new: true }).select('-password');
        res.json(user);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/user/change-password', authenticateToken, async (req, res) => {
    try {
        const { currentPassword, newPassword } = req.body;
        const user = await User.findById(req.user.id);
        const isMatch = await bcrypt.compare(currentPassword, user.password);
        if (!isMatch) return res.status(401).json({ error: 'Current password is incorrect' });

        const hashedPassword = await bcrypt.hash(newPassword, 10);
        user.password = hashedPassword;
        await user.save();
        res.json({ message: 'Password changed successfully' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.use((err, req, res, next) => {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
    console.log(`✓ ScriptForge Server running on port ${PORT}`);
});

module.exports = app;