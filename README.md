
### Prerequisites

- Node.js (v16 or higher)
- npm or yarn

### Installation

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd appointment-booking
   ```

2. **Install dependencies**
   ```bash
   # Install root dependencies
   npm install
   
   # Install frontend dependencies
   cd front-end
   npm install
   
   # Install backend dependencies
   cd ../back-end
   npm install
   ```

3. **Set up environment variables**
   ```bash
   # Copy the example environment file
   cd back-end
   cp env.example .env
   ```

4. **Start the development servers**
   ```bash
   # From the root directory
   npm run dev
   ```

   This will start both the frontend (port 3000) and backend (port 5000) servers concurrently.

### Manual Start (Alternative)

If you prefer to start servers manually:

```bash
# Start backend server
cd back-end
npm run dev

# In a new terminal, start frontend server
cd front-end
npm run dev
```
