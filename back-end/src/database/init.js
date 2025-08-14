const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, '../../database/appointments.db');

const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Error opening database:', err.message);
  } else {
    console.log('Connected to SQLite database');
  }
});

const initializeDatabase = () => {
  return new Promise((resolve, reject) => {
    db.run('PRAGMA foreign_keys = ON', (err) => {
      if (err) {
        console.error('Error enabling foreign keys:', err.message);
        reject(err);
        return;
      }
      
      db.run(`
        CREATE TABLE IF NOT EXISTS patients (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          email TEXT UNIQUE NOT NULL,
          phone TEXT,
          dateOfBirth TEXT,
          address TEXT,
          createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
          updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `, (err) => {
        if (err) {
          console.error('Error creating patients table:', err.message);
          reject(err);
          return;
        }
        console.log('Patients table created/verified');
        
        db.run(`
          CREATE TABLE IF NOT EXISTS doctors (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            email TEXT UNIQUE NOT NULL,
            phone TEXT,
            specialization TEXT,
            experience INTEGER,
            availability TEXT,
            createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
            updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
          )
        `, (err) => {
          if (err) {
            console.error('Error creating doctors table:', err.message);
            reject(err);
            return;
          }
          console.log('Doctors table created/verified');
          
          db.run(`
            CREATE TABLE IF NOT EXISTS appointments (
              id TEXT PRIMARY KEY,
              patientId TEXT,
              doctorId TEXT NOT NULL,
              date TEXT NOT NULL,
              time TEXT NOT NULL,
              status TEXT DEFAULT 'available' CHECK (status IN ('available', 'booked', 'cancelled', 'completed')),
              notes TEXT,
              createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
              updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
              FOREIGN KEY (patientId) REFERENCES patients (id) ON DELETE CASCADE,
              FOREIGN KEY (doctorId) REFERENCES doctors (id) ON DELETE CASCADE
            )
          `, (err) => {
            if (err) {
              console.error('Error creating appointments table:', err.message);
              reject(err);
              return;
            }
            console.log('Appointments table created/verified');

            db.all("PRAGMA table_info('appointments')", (err, columns) => {
              if (err) {
                console.error('Error reading appointments schema:', err.message);
                reject(err);
                return;
              }
              const patientCol = columns.find((c) => c.name === 'patientId');
              const isNotNull = patientCol && Number(patientCol.notnull) === 1;
              if (!isNotNull) {
                proceed();
                return;
              }

              console.warn('Detected legacy schema with patientId NOT NULL. Migrating to allow NULL...');
              db.serialize(() => {
                db.run(`
                  CREATE TABLE IF NOT EXISTS appointments_new (
                    id TEXT PRIMARY KEY,
                    patientId TEXT,
                    doctorId TEXT NOT NULL,
                    date TEXT NOT NULL,
                    time TEXT NOT NULL,
                    status TEXT DEFAULT 'available' CHECK (status IN ('available', 'booked', 'cancelled', 'completed')),
                    notes TEXT,
                    createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
                    updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (patientId) REFERENCES patients (id) ON DELETE CASCADE,
                    FOREIGN KEY (doctorId) REFERENCES doctors (id) ON DELETE CASCADE
                  )
                `, (err) => {
                  if (err) {
                    console.error('Error creating appointments_new table:', err.message);
                    reject(err);
                    return;
                  }
                  db.run(`
                    INSERT INTO appointments_new (id, patientId, doctorId, date, time, status, notes, createdAt, updatedAt)
                    SELECT id, patientId, doctorId, date, time, status, notes, createdAt, updatedAt FROM appointments
                  `, (err) => {
                    if (err) {
                      console.error('Error copying appointments data:', err.message);
                      reject(err);
                      return;
                    }
                    db.run('DROP TABLE IF EXISTS appointments', (err) => {
                      if (err) {
                        console.error('Error dropping old appointments table:', err.message);
                        reject(err);
                        return;
                      }
                      db.run('ALTER TABLE appointments_new RENAME TO appointments', (err) => {
                        if (err) {
                          console.error('Error renaming appointments_new table:', err.message);
                          reject(err);
                          return;
                        }
                        console.log('Migrated appointments schema: patientId is now NULLABLE');
                        proceed();
                      });
                    });
                  });
                });
              });
            });

            function proceed() {
              db.run('CREATE INDEX IF NOT EXISTS idx_appointments_doctor_date ON appointments(doctorId, date)', (err) => {
                if (err) console.error('Error creating index:', err.message);
              });
              db.run('CREATE INDEX IF NOT EXISTS idx_appointments_patient ON appointments(patientId)', (err) => {
                if (err) console.error('Error creating index:', err.message);
              });
              db.run('CREATE INDEX IF NOT EXISTS idx_appointments_status ON appointments(status)', (err) => {
                if (err) console.error('Error creating index:', err.message);
              });
              insertSampleData()
                .then(() => {
                  resolve();
                })
                .catch(reject);
            }
          });
        });
      });
    });
  });
};

// Insert sample data
const insertSampleData = () => {
  return new Promise((resolve, reject) => {
    // Always attempt to insert demo doctors/patients (idempotent via INSERT OR IGNORE)
    db.get('SELECT COUNT(*) as count FROM doctors', (err, row) => {
      if (err) {
        console.error('Error checking doctors table:', err.message);
        reject(err);
        return;
      }

      if (row && typeof row.count === 'number') {
        console.log(`ℹ️ Doctors count: ${row.count}`);
      }

      console.log('📝 Ensuring sample doctors/patients exist...');
        
        // Insert sample doctors
        const doctors = [
          {
            id: 'doc-001',
            name: 'Dr. Sarah Johnson',
            email: 'sarah.johnson@hospital.com',
            phone: '+1-555-0101',
            specialization: 'Cardiology',
            experience: 15,
            availability: JSON.stringify({
              slotLength: 30,
              mon: { start: '09:00', end: '17:00' },
              tue: { start: '09:00', end: '17:00' },
              wed: { start: '09:00', end: '17:00' },
              thu: { start: '09:00', end: '17:00' },
              fri: { start: '09:00', end: '17:00' },
              sat: { start: '10:00', end: '14:00' },
              sun: null
            })
          },
          {
            id: 'doc-002',
            name: 'Dr. Michael Chen',
            email: 'michael.chen@hospital.com',
            phone: '+1-555-0102',
            specialization: 'Neurology',
            experience: 12,
            availability: JSON.stringify({
              slotLength: 20,
              mon: { start: '10:00', end: '16:00' },
              tue: { start: '10:00', end: '16:00' },
              wed: { start: '10:00', end: '16:00' },
              thu: { start: '10:00', end: '16:00' },
              fri: { start: '10:00', end: '16:00' },
              sat: null,
              sun: null
            })
          },
          {
            id: 'doc-003',
            name: 'Dr. Emily Davis',
            email: 'emily.davis@hospital.com',
            phone: '+1-555-0103',
            specialization: 'Pediatrics',
            experience: 8,
            availability: JSON.stringify({
              slotLength: 30,
              mon: { start: '09:00', end: '15:00' },
              tue: { start: '09:00', end: '15:00' },
              wed: { start: '12:00', end: '18:00' },
              thu: { start: '09:00', end: '15:00' },
              fri: { start: '09:00', end: '15:00' },
              sat: { start: '10:00', end: '13:00' },
              sun: null
            })
          }
        ];

        const doctorStmt = db.prepare(`
          INSERT OR IGNORE INTO doctors (id, name, email, phone, specialization, experience, availability)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `);

        doctors.forEach(doctor => {
          doctorStmt.run([
            doctor.id,
            doctor.name,
            doctor.email,
            doctor.phone,
            doctor.specialization,
            doctor.experience,
            doctor.availability
          ]);
        });

        doctorStmt.finalize();

        // Insert sample patients
        const patients = [
          {
            id: 'pat-001',
            name: 'John Smith',
            email: 'john.smith@email.com',
            phone: '+1-555-0201',
            dateOfBirth: '1985-03-15'
          },
          {
            id: 'pat-002',
            name: 'Maria Garcia',
            email: 'maria.garcia@email.com',
            phone: '+1-555-0202',
            dateOfBirth: '1990-07-22'
          }
        ];

        const patientStmt = db.prepare(`
          INSERT OR IGNORE INTO patients (id, name, email, phone, dateOfBirth)
          VALUES (?, ?, ?, ?, ?)
        `);

        patients.forEach(patient => {
          patientStmt.run([
            patient.id,
            patient.name,
            patient.email,
            patient.phone,
            patient.dateOfBirth
          ]);
        });

        patientStmt.finalize();

        // Insert sample appointment slots
        const today = new Date();
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);
        
        const timeSlots = ['09:00', '10:00', '11:00', '14:00', '15:00', '16:00'];
        const appointmentStmt = db.prepare(`
          INSERT OR IGNORE INTO appointments (id, patientId, doctorId, date, time, status)
          VALUES (?, ?, ?, ?, ?, ?)
        `);

        doctors.forEach((doctor, doctorIndex) => {
          timeSlots.forEach((time, timeIndex) => {
            const appointmentId = `apt-${doctorIndex + 1}-${timeIndex + 1}`;
            const status = Math.random() > 0.7 ? 'booked' : 'available';
            const patientId = status === 'booked' ? patients[Math.floor(Math.random() * patients.length)].id : null;
            
            appointmentStmt.run([
              appointmentId,
              patientId,
              doctor.id,
              tomorrow.toISOString().split('T')[0],
              time,
              status
            ]);
          });
        });

        appointmentStmt.finalize();
        console.log('✅ Sample data ensured');
      
      resolve();
    });
  });
};

// Get database instance
const getDatabase = () => {
  return db;
};

module.exports = {
  initializeDatabase,
  getDatabase
};
