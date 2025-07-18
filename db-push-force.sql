-- Add unique constraint to tasks table if not exists
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conname = 'tasks_ticket_number_unique'
    ) THEN
        ALTER TABLE tasks ADD CONSTRAINT tasks_ticket_number_unique UNIQUE (ticket_number);
    END IF;
END $$;

-- Create smtp_settings table if not exists
CREATE TABLE IF NOT EXISTS smtp_settings (
    id SERIAL PRIMARY KEY,
    host VARCHAR(255) NOT NULL,
    port INTEGER NOT NULL DEFAULT 587,
    username VARCHAR(255) NOT NULL,
    password VARCHAR(255) NOT NULL,
    from_email VARCHAR(255) NOT NULL,
    from_name VARCHAR(255) NOT NULL DEFAULT 'TicketFlow',
    encryption VARCHAR(10) DEFAULT 'tls',
    is_active BOOLEAN DEFAULT true,
    updated_by VARCHAR REFERENCES users(id),
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create email_templates table if not exists
CREATE TABLE IF NOT EXISTS email_templates (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL UNIQUE,
    subject VARCHAR(255) NOT NULL,
    body TEXT NOT NULL,
    variables TEXT[] DEFAULT '{}',
    is_active BOOLEAN DEFAULT true,
    updated_by VARCHAR REFERENCES users(id),
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Insert default email templates
INSERT INTO email_templates (name, subject, body, variables) VALUES 
    ('ticket_created', 'New Ticket Created: {{ticketNumber}}', '<p>A new ticket has been created.</p><p>Ticket: {{ticketNumber}}<br>Title: {{title}}<br>Priority: {{priority}}</p>', ARRAY['ticketNumber', 'title', 'priority']),
    ('ticket_updated', 'Ticket Updated: {{ticketNumber}}', '<p>Ticket {{ticketNumber}} has been updated.</p><p>Status: {{status}}<br>Updated by: {{updatedBy}}</p>', ARRAY['ticketNumber', 'status', 'updatedBy']),
    ('ticket_assigned', 'Ticket Assigned to You: {{ticketNumber}}', '<p>You have been assigned to ticket {{ticketNumber}}.</p><p>Title: {{title}}<br>Priority: {{priority}}</p>', ARRAY['ticketNumber', 'title', 'priority'])
ON CONFLICT (name) DO NOTHING;