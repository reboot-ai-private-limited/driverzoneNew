## Goal Description
Before automating the process with CI/CD, we will first perform a manual deployment of the staging environment to ensure the Virtual Machine (VM) is correctly provisioned. This plan serves as a step-by-step guide to install Docker, set up SSH keys, clone the repository, and manually spin up the API and Web applications using `docker-compose.prod.yml`.

## User Review Required
> [!IMPORTANT]
> **OS Assumption**: This guide assumes the staging VM is running a Debian-based Linux distribution (like **Ubuntu 22.04 or 24.04**), which is standard for most VPS providers (AWS EC2, DigitalOcean, Hetzner, etc.). 
>
> **Secrets Management**: You will need to manually copy your production environment variables (like MongoDB secrets, Next.js API URLs) into the VM.

## Open Questions
> [!CAUTION]
> 1. Are you using Ubuntu for the staging VM? If not, the Docker installation commands will differ.
> 2. Do you have your required environment variables ready (e.g., `NEXT_PUBLIC_API_BASE_URL` and the values for `apps/api/.env.prod`)?

## Proposed Changes (Step-by-Step Guide)

Below is the step-by-step manual process that you will execute on your VM. Once approved, I can help you execute this if you have the VM credentials, or you can run these steps yourself.

### Step 1: Connect to the VM
SSH into your staging server from your local machine.
```bash
ssh username@your_staging_vm_ip
```

### Step 2: Install Docker & Docker Compose
Run the following commands on the VM to install Docker and the Compose plugin (Ubuntu instructions):

```bash
# 1. Update packages
sudo apt-get update
sudo apt-get install -y ca-certificates curl

# 2. Add Docker's official GPG key
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc

# 3. Add the repository to Apt sources
echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu \
  $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
  sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt-get update

# 4. Install Docker packages
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

# 5. Add your user to the docker group (so you don't need 'sudo' for docker commands)
sudo usermod -aG docker $USER
# NOTE: You must log out and log back into the VM for this group change to take effect!
```

### Step 3: Generate SSH Keys & Connect to GitHub
To pull your private repository securely, generate an SSH key on the VM and add it to GitHub as a "Deploy Key".

```bash
# Generate a new SSH key (press Enter to accept default path and no passphrase)
ssh-keygen -t ed25519 -C "staging-vm-deploy-key"

# Display the public key
cat ~/.ssh/id_ed25519.pub
```
**Action Required:** Copy the output of the `cat` command, go to your GitHub Repository -> **Settings** -> **Deploy Keys** -> **Add deploy key**, and paste the key.

```bash
# Verify connection to GitHub
ssh -T git@github.com
```

### Step 4: Clone the Repository
```bash
# Create a directory for deployments
mkdir -p ~/deployments && cd ~/deployments

# Clone the repository (replace with your actual git URL)
git clone git@github.com:reboot-ai-private-limited/driverzoneNew.git driverzone
cd driverzone

# Switch to the staging branch
git checkout staging
```

### Step 5: Configure Environment Variables
You must set up the environment variables before starting the containers.

There are two files, and they serve different phases — runtime for the API, **build** time for
the web panel.

```bash
# 1. API + worker runtime config
cp apps/api/.env.prod.example apps/api/.env.prod
# nano apps/api/.env.prod    # database/redis credentials, payment keys
#   - CORS_ORIGINS must be this VM's own origin, e.g. http://your_staging_vm_ip:3000.
#     The example ships http://localhost:3000, which blocks the panel the moment login works.
#   - Uncomment STAGING_UNSAFE=true and DEV_FIXED_OTP=000000 to be able to log in at all
#     (no SMS provider is wired up). STAGING ONLY — it opens an admin login whose credentials
#     are committed to this repo. See docs/engineering/build-and-deploy.md.
#   - GOOGLE_ROUTES_API_KEY: a server-side Google Maps key with the Routes API enabled,
#     restricted to this VM's egress IP. Without it, outstation quotes fault (there is no
#     OSRM service). Set a low daily quota cap and a billing alert in the Google Cloud console.

# 2. Web BUILD-time config, read by compose from the repo root
cp .env.example .env
# nano .env                  # set NEXT_PUBLIC_API_BASE_URL to this VM's public address
```

`NEXT_PUBLIC_API_BASE_URL` is the address the **browser** uses, so it must be the VM's public host
— not `localhost`, and not `http://api:4000`, which resolves only inside the compose network. The
web build fails with an explicit message if it is missing.

### Step 6: Build and Run the Stack
Run Docker Compose to build the images and start the services. It picks the `NEXT_PUBLIC_*` values
out of the repo-root `.env` you created in Step 5 and passes them to the web build as args — no
`export` needed.

```bash
# Build and start the services in detached mode
docker compose -f docker-compose.prod.yml up -d --build
```

Because `NEXT_PUBLIC_*` values are inlined into the client bundle, **changing the API URL later is
a rebuild, not a restart**:

```bash
# after editing .env
docker compose -f docker-compose.prod.yml up -d --build web
```

### Step 7: Seed the database

A fresh stack has no admin to log into the panel with and no zones. The seed is a one-shot service
behind a compose profile, so it never runs on `up`. Run it once the stack is healthy — `mongo-init`
must have promoted the replica set first:

```bash
docker compose -f docker-compose.prod.yml run --rm seed
```

It is idempotent, so running it again restores the intended state rather than duplicating anything.
It needs `STAGING_UNSAFE=true` from Step 5 and refuses to run without it. To wipe the seeded data
and recreate it:

```bash
docker compose -f docker-compose.prod.yml run --rm seed node dist/scripts/seed.js --reset
```

Log in at `http://your_staging_vm_ip:3000` as `+919000000001` with OTP `000000`.

## Verification Plan

### Manual Verification on the VM
Once the stack is running, run the following commands on the VM to verify:

1. **Check container status:**
   ```bash
   docker ps
   ```
   You should see `api`, `worker`, `web`, `mongo`, and `redis` running.

2. **Check container logs (if anything is failing):**
   ```bash
   docker compose -f docker-compose.prod.yml logs -f api
   docker compose -f docker-compose.prod.yml logs -f web
   ```

3. **Verify API Health:**
   ```bash
   curl -I http://localhost:4000/api/health
   # Should return HTTP 200 OK
   ```

4. **Verify Web Access:**
   Open a browser and navigate to `http://your_staging_vm_ip:3000`. The Next.js admin panel should load.
