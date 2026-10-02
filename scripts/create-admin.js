const mongoose = require('mongoose');
const User = require('../models/User');
const bcrypt = require('bcrypt');
const dotenv = require('dotenv');
const connectDB = require('../config/db');

dotenv.config();

const createAdmin = async () => {
  const name = process.env.ADMIN_NAME;
  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;

  if (!name || !email || !password) {
    console.error("Missing ADMIN credentials in .env");
    process.exit(1);
  }

  await connectDB();

  try {
    const existing = await User.findOne({ email: email.toLowerCase() });
    if (existing) {
      console.log("Admin user already exists. No action taken.");
      process.exit(0);
    }

    const passwordHash = await bcrypt.hash(password, 12);
    
    const admin = new User({
      name,
      email: email.toLowerCase(),
      passwordHash,
      role: 'ADMIN'
    });

    await admin.save();
    console.log("Admin user created successfully.");
    process.exit(0);
  } catch (err) {
    console.error("Error creating admin:", err.message);
    process.exit(1);
  }
};

createAdmin();
