// One-shot: create morning_digest + meeting_reminder Content templates,
// submit each for WhatsApp Meta approval, write the returned HX SIDs back
// into .env.local. Run once with `node scripts/twilio-create-templates.js`.

const fs = require('fs');

const envText = fs.readFileSync('.env.local', 'utf8');
function envVal(k) {
  const m = envText.match(new RegExp('^' + k + '=(.*)$', 'm'));
  return m ? m[1].trim() : '';
}
const sid  = envVal('TWILIO_ACCOUNT_SID');
const tok  = envVal('TWILIO_AUTH_TOKEN');
const auth = 'Basic ' + Buffer.from(sid + ':' + tok).toString('base64');

const TEMPLATES = [
  {
    envKey: 'TWILIO_TEMPLATE_MORNING_DIGEST_SID',
    friendly_name: 'taskbash_morning_digest',
    language: 'en',
    variables: { '1': 'Subash', '2': 'Mon Jun 1', '3': '2', '4': '5', '5': '4', '6': '9:00 AM Sigiq.ai x NationGraph', '7': '1) Discuss SpendHound. 2) Set up EverTutor. 3) Reply to Karttikeya.' },
    types: {
      'twilio/text': {
        body:
          '☀️ {{1}}, your {{2}} digest\n\n' +
          '{{3}} P0 · {{4}} P1 · {{5}} unread\n\n' +
          'Next: {{6}}\n\n' +
          'Top:\n{{7}}\n\n' +
          'Open: taskbash.app/today'
      }
    },
    approval: { name: 'taskbash_morning_digest', category: 'UTILITY' },
  },
  {
    envKey: 'TWILIO_TEMPLATE_MEETING_REMINDER_SID',
    friendly_name: 'taskbash_meeting_reminder',
    language: 'en',
    variables: { '1': 'Sigiq.ai x NationGraph', '2': '9:00 - 9:30 AM PT', '3': 'luke@nationgraph.com, josh@nationgraph.com', '4': 'NationGraph is pitching their gov sales intel platform. Aim: evaluate fit for EdTech vertical. They have prior touchpoints with two SigIQ customers.' },
    types: {
      'twilio/text': {
        body:
          '⏰ In 10 min: {{1}}\n\n' +
          '{{2}}\n\n' +
          'With: {{3}}\n\n' +
          'Prep: {{4}}'
      }
    },
    approval: { name: 'taskbash_meeting_reminder', category: 'UTILITY' },
  },
];

async function main() {
  const results = [];
  for (const tmpl of TEMPLATES) {
    console.log('\n--- ' + tmpl.friendly_name + ' ---');

    // 1. Check if it already exists (idempotency)
    const list = await fetch('https://content.twilio.com/v1/Content?PageSize=100', { headers: { Authorization: auth } }).then(r => r.json());
    const existing = (list.contents || []).find(c => c.friendly_name === tmpl.friendly_name);
    let contentSid = existing?.sid;

    if (contentSid) {
      console.log('Already exists: ' + contentSid + ' — skipping create');
    } else {
      const createRes = await fetch('https://content.twilio.com/v1/Content', {
        method: 'POST',
        headers: { Authorization: auth, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          friendly_name: tmpl.friendly_name,
          language: tmpl.language,
          variables: tmpl.variables,
          types: tmpl.types,
        }),
      });
      const j = await createRes.json();
      if (!createRes.ok) {
        console.error('CREATE failed:', createRes.status, JSON.stringify(j).slice(0, 500));
        process.exit(1);
      }
      contentSid = j.sid;
      console.log('Created: ' + contentSid);
    }

    // 2. Submit for WhatsApp approval (Meta review)
    const approvalRes = await fetch('https://content.twilio.com/v1/Content/' + contentSid + '/ApprovalRequests/whatsapp', {
      method: 'POST',
      headers: { Authorization: auth, 'Content-Type': 'application/json' },
      body: JSON.stringify(tmpl.approval),
    });
    const aj = await approvalRes.json();
    if (!approvalRes.ok) {
      // 409 = already submitted; treat as success
      if (approvalRes.status === 409) {
        console.log('Already submitted for approval');
      } else {
        console.error('APPROVAL submit failed:', approvalRes.status, JSON.stringify(aj).slice(0, 500));
      }
    } else {
      console.log('Submitted for WhatsApp approval. Status: ' + (aj.status ?? aj.whatsapp?.status ?? 'unknown'));
    }

    results.push({ envKey: tmpl.envKey, sid: contentSid });
  }

  // 3. Write SIDs back to .env.local (only the SIDs — not credentials)
  let next = envText;
  for (const r of results) {
    const re = new RegExp('^' + r.envKey + '=.*$', 'm');
    if (re.test(next)) {
      next = next.replace(re, r.envKey + '=' + r.sid);
    } else {
      next = next.trimEnd() + '\n' + r.envKey + '=' + r.sid + '\n';
    }
    console.log('env: ' + r.envKey + '=' + r.sid);
  }
  fs.writeFileSync('.env.local', next);
  console.log('\nWrote SIDs to .env.local');
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
