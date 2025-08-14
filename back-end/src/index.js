const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const path = require('path');
require('dotenv').config();

const appointmentRoutes = require('./routes/appointments');
const doctorRoutes = require('./routes/doctors');
const patientRoutes = require('./routes/patients');

const { initializeDatabase } = require('./database/init');

const app = express();
const PORT = process.env.PORT || 5000;

app.use(helmet());

const allowedOrigins = [
  process.env.FRONTEND_URL || 'http://localhost:3000',
  'http://localhost:3001',
];
app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
}));

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, 
  max: 100 // limit each IP to 100 requests per windowMs
});
app.use('/api/', limiter);

app.use(morgan('combined'));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

initializeDatabase();

app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    message: 'Appointment Booking API is running',
    timestamp: new Date().toISOString()
  });
});

app.use('/api/appointments', appointmentRoutes);
app.use('/api/doctors', doctorRoutes);
app.use('/api/patients', patientRoutes);

app.use('/api/*', (req, res) => {
  res.status(404).json({ 
    error: 'Endpoint not found',
    message: `The requested endpoint ${req.originalUrl} does not exist`
  });
});

app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ 
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong'
  });
});

app.listen(PORT, () => {
  console.log(`🚀 Server is running on port ${PORT}`);
  console.log(`📊 Health check: http://localhost:${PORT}/api/health`);
  console.log(`🌐 Frontend URL: ${process.env.FRONTEND_URL || 'http://localhost:3000'}`);
});

module.exports = app;
