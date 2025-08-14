const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { getDatabase } = require('../database/init');

const router = express.Router();
const db = getDatabase();

function generateDaySlots(date, startTime = '09:00', endTime = '17:00', stepMinutes = 30) {
  const slots = [];
  const [sh, sm] = startTime.split(':').map((n) => parseInt(n, 10));
  const [eh, em] = endTime.split(':').map((n) => parseInt(n, 10));
  const start = new Date(`${date}T${String(sh).padStart(2, '0')}:${String(sm).padStart(2, '0')}:00`);
  const end = new Date(`${date}T${String(eh).padStart(2, '0')}:${String(em).padStart(2, '0')}:00`);
  const pad = (n) => (n < 10 ? `0${n}` : `${n}`);
  for (let t = new Date(start); t < end; t.setMinutes(t.getMinutes() + stepMinutes)) {
    const hh = pad(t.getHours());
    const mm = pad(t.getMinutes());
    slots.push(`${hh}:${mm}`);
  }
  return slots;
}

function ensureSlotsForDoctorDate(doctorId, date) {
  return new Promise((resolve, reject) => {
    db.get('SELECT availability FROM doctors WHERE id = ?', [doctorId], (docErr, docRow) => {
      if (docErr) return reject(docErr);
      if (!docRow) {
        const err = new Error('Doctor not found');
        err.code = 'DOCTOR_NOT_FOUND';
        return reject(err);
      }

      let startTime = '09:00';
      let endTime = '17:00';
      let stepMinutes = 30;
      try {
        if (docRow && docRow.availability) {
          const av = JSON.parse(docRow.availability);
          const weekday = new Date(date + 'T00:00:00').getDay(); // 0-6
          const dayMap = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
          const key = dayMap[weekday];
          if (av && av[key]) {
            startTime = av[key].start || startTime;
            endTime = av[key].end || endTime;
          }
          if (av && typeof av.slotLength === 'number') {
            stepMinutes = av.slotLength;
          }
        }
      } catch (_) {
      }

      db.all(
        'SELECT time FROM appointments WHERE doctorId = ? AND date = ?',
        [doctorId, date],
        (err, rows) => {
          if (err) return reject(err);
          const existingTimes = new Set(rows.map((r) => r.time));
          const defaults = generateDaySlots(date, startTime, endTime, stepMinutes);
          const toInsert = defaults.filter((t) => !existingTimes.has(t));
          if (toInsert.length === 0) return resolve();

          const now = new Date().toISOString();
          db.serialize(() => {
            const stmt = db.prepare(
              'INSERT INTO appointments (id, patientId, doctorId, date, time, status, notes, createdAt, updatedAt) VALUES (?, NULL, ?, ?, ?, "available", NULL, ?, ?)'
            );
            toInsert.forEach((time) => {
              stmt.run(uuidv4(), doctorId, date, time, now, now);
            });
            stmt.finalize((finalizeErr) => {
              if (finalizeErr) return reject(finalizeErr);
              resolve();
            });
          });
        }
      );
    });
  });
}

router.get('/', (req, res) => {
  const query = `
    SELECT 
      a.*,
      p.name as patientName,
      p.email as patientEmail,
      p.phone as patientPhone,
      d.name as doctorName,
      d.specialization as doctorSpecialization,
      d.email as doctorEmail,
      d.phone as doctorPhone
    FROM appointments a
    LEFT JOIN patients p ON a.patientId = p.id
    LEFT JOIN doctors d ON a.doctorId = d.id
    ORDER BY a.date DESC, a.time ASC
  `;

  db.all(query, [], (err, rows) => {
    if (err) {
      console.error('Error fetching appointments:', err);
      return res.status(500).json({ error: 'Failed to fetch appointments' });
    }
    res.json(rows);
  });
});

router.get('/:id', (req, res) => {
  const { id } = req.params;
  
  const query = `
    SELECT 
      a.*,
      p.name as patientName,
      p.email as patientEmail,
      p.phone as patientPhone,
      d.name as doctorName,
      d.specialization as doctorSpecialization,
      d.email as doctorEmail,
      d.phone as doctorPhone
    FROM appointments a
    LEFT JOIN patients p ON a.patientId = p.id
    LEFT JOIN doctors d ON a.doctorId = d.id
    WHERE a.id = ?
  `;

  db.get(query, [id], (err, row) => {
    if (err) {
      console.error('Error fetching appointment:', err);
      return res.status(500).json({ error: 'Failed to fetch appointment' });
    }
    if (!row) {
      return res.status(404).json({ error: 'Appointment not found' });
    }
    res.json(row);
  });
});

router.post('/', (req, res) => {
  const { patientId, doctorId, date, time, notes } = req.body;

  if (!patientId || !doctorId || !date || !time) {
    return res.status(400).json({ 
      error: 'Missing required fields: patientId, doctorId, date, time' 
    });
  }

  const appointmentDate = new Date(date);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  if (appointmentDate < today) {
    return res.status(400).json({ error: 'Cannot book appointments in the past' });
  }

  db.get(
    'SELECT * FROM appointments WHERE doctorId = ? AND date = ? AND time = ?',
    [doctorId, date, time],
    (err, existingSlot) => {
      if (err) {
        console.error('Error checking slot availability:', err);
        return res.status(500).json({ error: 'Failed to check slot availability' });
      }

      if (existingSlot && existingSlot.status !== 'available') {
        return res.status(400).json({ error: 'Selected time slot is not available' });
      }

      db.get(
        'SELECT * FROM appointments WHERE patientId = ? AND date = ? AND time = ? AND status = "booked"',
        [patientId, date, time],
        (err, existingAppointment) => {
          if (err) {
            console.error('Error checking patient availability:', err);
            return res.status(500).json({ error: 'Failed to check patient availability' });
          }

          if (existingAppointment) {
            return res.status(400).json({ error: 'Patient already has an appointment at this time' });
          }

          const now = new Date().toISOString();
          const appointmentId = existingSlot ? existingSlot.id : uuidv4();

          if (existingSlot) {
            db.run(
              'UPDATE appointments SET patientId = ?, status = "booked", notes = ?, updatedAt = ? WHERE id = ?',
              [patientId, notes || null, now, existingSlot.id],
              function(err) {
                if (err) {
                  console.error('Error booking appointment:', err);
                  return res.status(500).json({ error: 'Failed to book appointment' });
                }
                returnBookedAppointment(existingSlot.id);
              }
            );
          } else {
            db.run(
              'INSERT INTO appointments (id, patientId, doctorId, date, time, status, notes, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, "booked", ?, ?, ?)',
              [appointmentId, patientId, doctorId, date, time, notes || null, now, now],
              function(err) {
                if (err) {
                  console.error('Error creating appointment:', err);
                  return res.status(500).json({ error: 'Failed to create appointment' });
                }
                returnBookedAppointment(appointmentId);
              }
            );
          }

          function returnBookedAppointment(id) {
            const query = `
              SELECT 
                a.*,
                p.name as patientName,
                p.email as patientEmail,
                p.phone as patientPhone,
                d.name as doctorName,
                d.specialization as doctorSpecialization,
                d.email as doctorEmail,
                d.phone as doctorPhone
              FROM appointments a
              LEFT JOIN patients p ON a.patientId = p.id
              LEFT JOIN doctors d ON a.doctorId = d.id
              WHERE a.id = ?
            `;

            db.get(query, [id], (err, appointment) => {
              if (err) {
                console.error('Error fetching booked appointment:', err);
                return res.status(500).json({ error: 'Appointment booked but failed to retrieve details' });
              }
              res.status(201).json({
                message: 'Appointment booked successfully',
                appointment
              });
            });
          }
        }
      );
    }
  );
});

router.put('/:id', (req, res) => {
  const { id } = req.params;
  const { doctorId, date, time, notes } = req.body;

  db.get('SELECT * FROM appointments WHERE id = ?', [id], (err, appointment) => {
    if (err) {
      console.error('Error fetching appointment:', err);
      return res.status(500).json({ error: 'Failed to fetch appointment' });
    }

    if (!appointment) {
      return res.status(404).json({ error: 'Appointment not found' });
    }

    if (appointment.status !== 'booked') {
      return res.status(400).json({ error: 'Only booked appointments can be rescheduled' });
    }

    if (date) {
      const appointmentDate = new Date(date);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      
      if (appointmentDate < today) {
        return res.status(400).json({ error: 'Cannot reschedule appointments to the past' });
      }
    }

    db.get(
      'SELECT * FROM appointments WHERE doctorId = ? AND date = ? AND time = ? AND status = "available"',
      [doctorId || appointment.doctorId, date || appointment.date, time || appointment.time],
      (err, newSlot) => {
        if (err) {
          console.error('Error checking new slot availability:', err);
          return res.status(500).json({ error: 'Failed to check slot availability' });
        }

        if (!newSlot) {
          return res.status(400).json({ error: 'New time slot is not available' });
        }

        db.get(
          'SELECT * FROM appointments WHERE patientId = ? AND date = ? AND time = ? AND status = "booked" AND id != ?',
          [appointment.patientId, date || appointment.date, time || appointment.time, id],
          (err, existingAppointment) => {
            if (err) {
              console.error('Error checking patient availability:', err);
              return res.status(500).json({ error: 'Failed to check patient availability' });
            }

            if (existingAppointment) {
              return res.status(400).json({ error: 'Patient already has an appointment at this time' });
            }

            db.run(
              'UPDATE appointments SET patientId = NULL, status = "available", notes = NULL, updatedAt = ? WHERE id = ?',
              [new Date().toISOString(), id],
              (err) => {
                if (err) {
                  console.error('Error freeing old slot:', err);
                  return res.status(500).json({ error: 'Failed to reschedule appointment' });
                }

                db.run(
                  'UPDATE appointments SET patientId = ?, status = "booked", notes = ?, updatedAt = ? WHERE id = ?',
                  [appointment.patientId, notes || appointment.notes, new Date().toISOString(), newSlot.id],
                  function(err) {
                    if (err) {
                      console.error('Error booking new slot:', err);
                      return res.status(500).json({ error: 'Failed to reschedule appointment' });
                    }

                    res.json({
                      message: 'Appointment rescheduled successfully',
                      appointmentId: newSlot.id
                    });
                  }
                );
              }
            );
          }
        );
      }
    );
  });
});

router.patch('/:id/cancel', (req, res) => {
  const { id } = req.params;

  db.get('SELECT * FROM appointments WHERE id = ?', [id], (err, appointment) => {
    if (err) {
      console.error('Error fetching appointment:', err);
      return res.status(500).json({ error: 'Failed to fetch appointment' });
    }

    if (!appointment) {
      return res.status(404).json({ error: 'Appointment not found' });
    }

    if (appointment.status !== 'booked') {
      return res.status(400).json({ error: 'Only booked appointments can be cancelled' });
    }

    const appointmentDate = new Date(appointment.date);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    if (appointmentDate < today) {
      return res.status(400).json({ error: 'Cannot cancel past appointments' });
    }

    db.run(
      'UPDATE appointments SET status = "available", patientId = NULL, notes = NULL, updatedAt = ? WHERE id = ?',
      [new Date().toISOString(), id],
      function(err) {
        if (err) {
          console.error('Error cancelling appointment:', err);
          return res.status(500).json({ error: 'Failed to cancel appointment' });
        }

        res.json({ message: 'Appointment cancelled and slot freed successfully' });
      }
    );
  });
});

router.get('/slots/available', async (req, res) => {
  const { doctorId, date, includeBooked } = req.query;

  if (!doctorId || !date) {
    return res.status(400).json({ 
      error: 'Missing required query parameters: doctorId, date' 
    });
  }

  const appointmentDate = new Date(date);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  if (appointmentDate < today) {
    return res.status(400).json({ error: 'Cannot view slots for past dates' });
  }

  try {
    await ensureSlotsForDoctorDate(doctorId, date);

    const includeAll = String(includeBooked).toLowerCase() === 'true';
    const query = includeAll
      ? `SELECT id, doctorId, date, time, status FROM appointments WHERE doctorId = ? AND date = ? ORDER BY time ASC`
      : `SELECT id, doctorId, date, time, status FROM appointments WHERE doctorId = ? AND date = ? AND status = "available" ORDER BY time ASC`;

    db.all(query, [doctorId, date], (err, rows) => {
      if (err) {
        console.error('Error fetching available slots:', err);
        return res.status(500).json({ error: 'Failed to fetch available slots' });
      }
      res.json(rows);
    });
  } catch (e) {
    if (e && e.code === 'DOCTOR_NOT_FOUND') {
      return res.status(404).json({ error: 'Doctor not found' });
    }
    console.error('Error ensuring slots exist:', e);
    return res.status(500).json({ error: 'Failed to prepare available slots' });
  }
});

router.get('/patient/:patientId', (req, res) => {
  const { patientId } = req.params;
  const { status, past } = req.query;

  let query = `
    SELECT 
      a.*,
      d.name as doctorName,
      d.specialization as doctorSpecialization,
      d.email as doctorEmail,
      d.phone as doctorPhone
    FROM appointments a
    LEFT JOIN doctors d ON a.doctorId = d.id
    WHERE a.patientId = ?
  `;

  const params = [patientId];

  if (status) {
    query += ' AND a.status = ?';
    params.push(status);
  }

  if (past === 'true') {
    query += ' AND a.date < ?';
    params.push(new Date().toISOString().split('T')[0]);
  } else if (past === 'false') {
    query += ' AND a.date >= ?';
    params.push(new Date().toISOString().split('T')[0]);
  }

  query += ' ORDER BY a.date DESC, a.time ASC';

  db.all(query, params, (err, rows) => {
    if (err) {
      console.error('Error fetching patient appointments:', err);
      return res.status(500).json({ error: 'Failed to fetch patient appointments' });
    }
    res.json(rows);
  });
});

router.get('/past/all', (req, res) => {
  const { patientId, doctorId, limit = 50 } = req.query;

  let query = `
    SELECT 
      a.*,
      p.name as patientName,
      p.email as patientEmail,
      p.phone as patientPhone,
      d.name as doctorName,
      d.specialization as doctorSpecialization,
      d.email as doctorEmail,
      d.phone as doctorPhone
    FROM appointments a
    LEFT JOIN patients p ON a.patientId = p.id
    LEFT JOIN doctors d ON a.doctorId = d.id
    WHERE a.date < ? AND a.status IN ('completed', 'cancelled')
  `;

  const params = [new Date().toISOString().split('T')[0]];

  if (patientId) {
    query += ' AND a.patientId = ?';
    params.push(patientId);
  }

  if (doctorId) {
    query += ' AND a.doctorId = ?';
    params.push(doctorId);
  }

  query += ' ORDER BY a.date DESC, a.time ASC LIMIT ?';
  params.push(parseInt(limit));

  db.all(query, params, (err, rows) => {
    if (err) {
      console.error('Error fetching past appointments:', err);
      return res.status(500).json({ error: 'Failed to fetch past appointments' });
    }
    res.json(rows);
  });
});

router.get('/upcoming', (req, res) => {
  const { patientId, doctorId, limit = 10 } = req.query;

  const today = new Date();
  const nextWeek = new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000);

  let query = `
    SELECT 
      a.*,
      p.name as patientName,
      p.email as patientEmail,
      p.phone as patientPhone,
      d.name as doctorName,
      d.specialization as doctorSpecialization,
      d.email as doctorEmail,
      d.phone as doctorPhone
    FROM appointments a
    LEFT JOIN patients p ON a.patientId = p.id
    LEFT JOIN doctors d ON a.doctorId = d.id
    WHERE a.date BETWEEN ? AND ? AND a.status = 'booked'
  `;

  const params = [today.toISOString().split('T')[0], nextWeek.toISOString().split('T')[0]];

  if (patientId) {
    query += ' AND a.patientId = ?';
    params.push(patientId);
  }

  if (doctorId) {
    query += ' AND a.doctorId = ?';
    params.push(doctorId);
  }

  query += ' ORDER BY a.date ASC, a.time ASC LIMIT ?';
  params.push(parseInt(limit));

  db.all(query, params, (err, rows) => {
    if (err) {
      console.error('Error fetching upcoming appointments:', err);
      return res.status(500).json({ error: 'Failed to fetch upcoming appointments' });
    }
    res.json(rows);
  });
});

router.get('/time-slots', (req, res) => {
  const { doctorId, date } = req.query;

  if (!doctorId || !date) {
    return res.status(400).json({ error: 'doctorId and date are required' });
  }

  const appointmentDate = new Date(date);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  if (appointmentDate < today) {
    return res.status(400).json({ error: 'Cannot get slots for past dates' });
  }

  const query = `
    SELECT 
      id,
      doctorId,
      date,
      time,
      status,
      patientId,
      notes
    FROM appointments 
    WHERE doctorId = ? AND date = ?
    ORDER BY time ASC
  `;

  db.all(query, [doctorId, date], (err, rows) => {
    if (err) {
      console.error('Error fetching time slots:', err);
      return res.status(500).json({ error: 'Failed to fetch time slots' });
    }

    if (rows.length === 0) {
      const defaultTimeSlots = ['09:00', '10:00', '11:00', '14:00', '15:00', '16:00'];
      const slots = defaultTimeSlots.map((time, index) => ({
        id: `slot-${doctorId}-${date}-${index}`,
        doctorId,
        date,
        time,
        status: 'available',
        patientId: null,
        notes: null
      }));
      return res.json(slots);
    }

    res.json(rows);
  });
});

module.exports = router;
