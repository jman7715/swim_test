const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

// 주소에 혹시 남아있을 수 있는 /rest/v1/ 이나 불필요한 슬래시를 자동으로 제거
let rawUrl = process.env.SUPABASE_URL || 'https://wyyxcwmwuwumkkoltdoa.supabase.co';
const supabaseUrl = rawUrl.replace(/\/rest\/v1\/?$/, '').replace(/\/+$/, '');
const supabaseKey = process.env.SUPABASE_KEY || 'sb_publishable_98AgxVWusnJZtiEkGPe5Fw_J530lsq_';

const supabase = createClient(supabaseUrl, supabaseKey);

module.exports = supabase;