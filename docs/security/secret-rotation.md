# Secret Rotation Guide

Frequency: **every 90 days** or immediately when compromised.

---

## 1. HIVEMI_SECRET

The shared authentication token between all components.

### Steps

1. **Generate a new secret:**
   ```bash
   openssl rand -hex 32
   ```

2. **Update on control plane:**
   ```bash
   # Update in control plane environment
   # (Manager, Registry, Dashboard .env files)
   HIVEMI_SECRET=<new-secret>
   ```

3. **Restart control plane services:**
   ```bash
   # Restart Registry and Manager
   systemctl restart hivemi-registry
   systemctl restart hivemi-manager
   ```

4. **Redeploy all agents:**
   ```
   Dashboard → Agents → Select agent → Redeploy
   ```
   Redeployment will inject the new secret into each agent's `.env` file.

   > **Note:** Agents using the old secret will fail auth immediately after
   > the control plane is restarted. Plan for brief downtime or do a rolling
   > update: update control plane to accept both old and new secrets temporarily.

### Rollback

If something goes wrong, revert `HIVEMI_SECRET` to the old value and restart services.

---

## 2. SSH Deploy Key (`hivemi-deploy`)

The ed25519 key used by the Bootstrapper to SSH into agent VMs.

### Steps

1. **Generate new SSH key pair:**
   ```
   Dashboard → Settings → Cloud → Generate SSH Key
   ```
   This generates a new ed25519 keypair, stores the private key encrypted
   in the settings table, and returns the new public key.

2. **Register with cloud provider:**
   The new public key is automatically registered with the cloud provider
   (e.g. DigitalOcean) on the next deploy. The `sshKeyId` in settings
   is updated automatically.

3. **Redeploy agents:**
   New deploys will use the new SSH key. Existing VMs still have the old
   public key in their `~/.ssh/authorized_keys` — they remain accessible
   until redeployed.

4. **(Optional) Remove old key from provider:**
   After all agents are redeployed, remove the old SSH key from the
   cloud provider's account to prevent future use.

### Notes

- The old key continues to work on existing VMs until they are redeployed
- Redeployment is an immutable operation (destroy old VM + create new)
- The private key never leaves the control plane

---

## 3. LLM API Keys

API keys for OpenAI, Anthropic, etc.

### Steps

1. **Rotate the key in the provider's dashboard** (OpenAI, Anthropic, etc.)

2. **Update in 1Password:**
   Update the API key value in the appropriate 1Password vault item.

3. **Redeploy affected agents:**
   ```
   Dashboard → Agents → Select agent → Redeploy
   ```
   The Bootstrapper resolves secrets via 1Password during bootstrap,
   so redeploying will inject the new key.

### Notes

- LLM API calls use HTTPS (handled by provider SDKs)
- Keys are never stored on the control plane — only in 1Password
- 1Password token on the control plane is used only during bootstrap

---

## 4. DigitalOcean API Token

The token used by the Provisioner to create/destroy VMs.

### Steps

1. **Generate new token in DigitalOcean dashboard:**
   `API → Tokens → Generate New Token`

2. **Update in HiveMI:**
   ```
   Dashboard → Settings → Cloud → Update API Token
   ```
   The new token is encrypted at rest in the settings table.

3. **Test connection:**
   ```
   Dashboard → Settings → Cloud → Test Connection
   ```

4. **Revoke old token in DigitalOcean dashboard.**

### Notes

- The DO token only exists on the control plane (never sent to agent VMs)
- Used by the Provisioner for VM lifecycle operations

---

## 5. 1Password Service Account Token

The token used to access the 1Password vault during bootstrap.

### Steps

1. **Create new service account in 1Password:**
   `1Password → Settings → Service Accounts → Create`

2. **Update on control plane:**
   ```bash
   # Update the token file
   echo "<new-token>" > ~/.openclaw/secrets/op_token
   chmod 600 ~/.openclaw/secrets/op_token
   ```

3. **Test by deploying a new agent.**

4. **Revoke old service account in 1Password.**

### Notes

- The 1Password token only exists on the control plane
- It's used during bootstrap to resolve secrets, then never persisted on VMs
- Grant minimal vault access (only the secrets agents need)

---

## Emergency Rotation

If you suspect a secret has been compromised:

1. **Rotate the compromised secret immediately** (follow steps above)
2. **Check audit logs** for unauthorized access
3. **Redeploy all agents** to ensure no VM has the old secret
4. **Review access:** Check which VMs were active during the compromise window
5. **Consider rotating adjacent secrets** (if one key is compromised, assume related keys may be too)

---

## Automation (Future)

Currently all rotation is manual. Planned improvements:

- [ ] `hivemi secrets rotate <secret-name>` CLI command
- [ ] Automatic 90-day reminders via Dashboard notifications
- [ ] Rolling secret update (accept old + new during transition window)
- [ ] Audit log of secret access and rotation events
