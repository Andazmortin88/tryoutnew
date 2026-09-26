const {
  useEffect,
  useMemo,
  useState,
  useRef
} = React;
const APP_CONFIG = {
  SUPABASE_URL: 'https://rnvmaihjaxpvsgnaczod.supabase.co',
  SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_Ma5Bmh-wMjTWWGsBrLfOvA_mEsqleHA',
  PAYMENT_EDGE_FUNCTION: 'create-midtrans-transaction',
  PROMO_PRICE: 40000,
  NORMAL_PRICE: 150000
};
const supabaseClient = window.supabase.createClient(APP_CONFIG.SUPABASE_URL, APP_CONFIG.SUPABASE_PUBLISHABLE_KEY);
const LETTERS = ['A', 'B', 'C', 'D', 'E'];
const PROGRAM_AREAS = {
  ners: ['KMB', 'Maternitas', 'Anak', 'Jiwa', 'Keluarga', 'Gerontik', 'Manajemen', 'Gawat Darurat', 'Komunitas', 'Etik'],
  d3: ['KMB', 'Maternitas', 'Anak', 'Jiwa', 'Keluarga', 'Gerontik', 'Manajemen', 'Gawat Darurat', 'Komunitas', 'Etik'],
  bidan: ['Pranikah & Prakonsepsi', 'Kehamilan', 'Persalinan', 'Nifas & Menyusui', 'Neonatus/Bayi/Balita', 'KB & Kesehatan Reproduksi', 'Etik-Komunikasi-Manajemen']
};
function areasForProgram(p) {
  return PROGRAM_AREAS[p] || PROGRAM_AREAS.ners;
}
const STORAGE = {
  SESSION: 'ukom_v4_active_session',
  FAVORITES: 'ukom_v4_favorites'
};
function load(k, d) {
  try {
    const v = localStorage.getItem(k);
    return v ? JSON.parse(v) : d;
  } catch {
    return d;
  }
}
function save(k, v) {
  localStorage.setItem(k, JSON.stringify(v));
}
function shuffle(a) {
  const x = [...a];
  for (let i = x.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [x[i], x[j]] = [x[j], x[i]];
  }
  return x;
}
function prepareQuestion(q, randomize = true) {
  if (!randomize) return {
    ...q,
    optionMap: [0, 1, 2, 3, 4]
  };
  const p = shuffle(q.options.map((text, originalIndex) => ({
    text,
    originalIndex
  })));
  return {
    ...q,
    options: p.map(x => x.text),
    optionMap: p.map(x => x.originalIndex)
  };
}
function fmtTime(sec) {
  const h = Math.floor(sec / 3600),
    m = Math.floor(sec % 3600 / 60),
    s = sec % 60;
  return `${h ? String(h).padStart(2, '0') + ':' : ''}${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
function money(n) {
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    maximumFractionDigits: 0
  }).format(n);
}
function fmtDateID(v) {
  if (!v) return '';
  try {
    return new Intl.DateTimeFormat('id-ID', {
      day: '2-digit',
      month: 'short',
      year: 'numeric'
    }).format(new Date(v));
  } catch {
    return '';
  }
}
function readiness(s) {
  if (s >= 75) return {
    label: 'Performa Latihan Tinggi',
    tone: 'emerald',
    message: 'Pertahankan konsistensi dan fokuskan latihan pada area terlemah.'
  };
  if (s >= 60) return {
    label: 'Performa Latihan Sedang',
    tone: 'amber',
    message: 'Dasar latihan cukup, tetapi masih ada area yang perlu penguatan terarah.'
  };
  return {
    label: 'Perlu Penguatan Latihan',
    tone: 'rose',
    message: 'Prioritaskan latihan per area dan ulangi soal yang masih salah.'
  };
}
function programLabel(p) {
  return p === 'd3' ? 'D3 Keperawatan' : p === 'bidan' ? 'Profesi Bidan' : 'Profesi Ners';
}
function remapExplanation(text, optionOrder) {
  if (!text || !Array.isArray(optionOrder) || optionOrder.length !== 5) return text || 'Pembahasan belum tersedia.';
  const originalToDisplay = {};
  optionOrder.forEach((orig, display) => {
    originalToDisplay[LETTERS[orig]] = LETTERS[display];
  });
  const tokenMap = {
    A: '§A§',
    B: '§B§',
    C: '§C§',
    D: '§D§',
    E: '§E§'
  };
  let out = String(text);
  for (const l of LETTERS) {
    out = out.replace(new RegExp('(^|\\n)' + l + '([\\.\\:)])', 'gm'), (_, p1, p2) => p1 + tokenMap[l] + p2);
    out = out.replace(new RegExp('(Kunci jawaban:\\s*)' + l + '([\\.\\:)])', 'gi'), (_, p1, p2) => p1 + tokenMap[l] + p2);
  }
  for (const l of LETTERS) out = out.replaceAll(tokenMap[l], originalToDisplay[l] || l);
  return out;
}
function sessionFromPayload(data, local) {
  if (!data) return null;
  const questions = (data.questions || []).map(row => ({
    id: Number(row.id),
    rumpun: row.area,
    subtopic: row.subtopic || '',
    text: row.vignette,
    options: row.options || [],
    difficulty: row.difficulty,
    cognitiveLevel: row.cognitive_level,
    blueprintTag: row.blueprint_tag
  }));
  const same = local && local.sessionId === data.session_id;
  const serverAnswers = {};
  const serverFlagged = [];
  const byId = new Map(questions.map((q, i) => [Number(q.id), i]));
  (Array.isArray(data.answers) ? data.answers : []).forEach(r => {
    const idx = byId.get(Number(r.question_id));
    if (idx === undefined) return;
    if (r.selected_index !== null && r.selected_index !== undefined) serverAnswers[idx] = Number(r.selected_index);
    if (r.is_flagged) serverFlagged.push(idx);
  });
  return {
    sessionId: data.session_id,
    program: data.program,
    mode: data.mode,
    area: data.area || 'Semua',
    questions,
    answers: same ? local.answers || {} : serverAnswers,
    flagged: same ? local.flagged || [] : serverFlagged,
    current: same ? Math.min(Number(local.current || 0), Math.max(questions.length - 1, 0)) : 0,
    startedAt: data.created_at,
    expiresAt: data.expires_at || null,
    serverNow: data.server_now || null,
    lastSavedAt: data.last_saved_at || null
  };
}
function attemptFromPayload(data) {
  const review = data?.review || [];
  const questions = review.map(r => ({
    id: Number(r.question_id),
    rumpun: r.area || '',
    subtopic: r.subtopic || '',
    text: r.vignette || '',
    options: r.options || [],
    optionMap: (r.option_order || [0, 1, 2, 3, 4]).map(Number),
    correctAnswer: Number(r.correct_option_display),
    explanation: remapExplanation(r.explanation, r.option_order || [0, 1, 2, 3, 4]),
    reference: r.reference_text || ''
  }));
  const answers = {};
  const flagged = [];
  review.forEach((r, i) => {
    if (r.selected_option_display !== null && r.selected_option_display !== undefined) answers[i] = Number(r.selected_option_display);
    if (r.is_flagged) flagged.push(i);
  });
  return {
    id: data.attempt_id,
    sessionId: data.session_id,
    program: data.program,
    createdAt: data.finished_at,
    startedAt: data.started_at,
    mode: data.mode,
    score: Number(data.score || 0),
    correct: Number(data.correct || 0),
    answered: Number(data.answered || 0),
    total: Number(data.total || questions.length),
    byArea: data.byArea || {},
    wrongIds: (data.wrongIds || []).map(Number),
    questions,
    answers,
    flagged
  };
}
function App() {
  const [authUser, setAuthUser] = useState(null),
    [authLoading, setAuthLoading] = useState(true);
  const [profile, setProfile] = useState(null),
    [profileLoading, setProfileLoading] = useState(false),
    [profileError, setProfileError] = useState('');
  const [access, setAccess] = useState(null),
    [attempts, setAttempts] = useState([]),
    [wrongIds, setWrongIds] = useState([]),
    [favorites, setFavorites] = useState(() => load(STORAGE.FAVORITES, []));
  const [view, setView] = useState('dashboard'),
    [setup, setSetup] = useState({
      mode: 'learn',
      area: 'Semua',
      count: 20,
      randomize: true
    });
  const [session, setSession] = useState(null),
    [lastAttempt, setLastAttempt] = useState(null),
    [message, setMessage] = useState(''),
    [paywall, setPaywall] = useState(false);
  const [busy, setBusy] = useState({
    start: false,
    submit: false,
    checkout: false,
    review: false
  });
  useEffect(() => save(STORAGE.FAVORITES, favorites), [favorites]);
  useEffect(() => {
    let mounted = true;
    supabaseClient.auth.getSession().then(({
      data
    }) => {
      if (mounted) {
        setAuthUser(data.session?.user || null);
        setAuthLoading(false);
      }
    });
    const {
      data: {
        subscription
      }
    } = supabaseClient.auth.onAuthStateChange((_e, s) => {
      if (mounted) {
        setAuthUser(s?.user || null);
        setAuthLoading(false);
      }
    });
    return () => {
      mounted = false;
      subscription?.unsubscribe();
    };
  }, []);
  useEffect(() => {
    if (authUser?.id) loadProfile();else {
      setProfile(null);
      setAccess(null);
      setAttempts([]);
      setWrongIds([]);
      setSession(null);
      setProfileError('');
    }
  }, [authUser?.id]);
  useEffect(() => {
    if (profile?.program) {
      setSetup(prev => ({
        ...prev,
        area: 'Semua'
      }));
      setLastAttempt(null);
      refreshAccess();
      loadCloudProgress(profile.program);
      restoreSession(profile.program);
    }
  }, [profile?.program]);
  async function googleLogin() {
    const {
      error
    } = await supabaseClient.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: window.location.origin + window.location.pathname
      }
    });
    if (error) setMessage('Login belum berhasil. Silakan coba lagi.');
  }
  async function signOut() {
    localStorage.removeItem(STORAGE.SESSION);
    setSession(null);
    setLastAttempt(null);
    await supabaseClient.auth.signOut();
    setView('dashboard');
  }
  async function loadProfile() {
    setProfileLoading(true);
    setProfileError('');
    try {
      const {
        data,
        error
      } = await supabaseClient.from('profiles').select('*').eq('id', authUser.id).maybeSingle();
      if (error) throw error;
      setProfile(data || {
        id: authUser.id,
        full_name: authUser.user_metadata?.full_name || authUser.user_metadata?.name || '',
        email: authUser.email,
        institution: '',
        program: null,
        target_ukom: '2026',
        phone: ''
      });
    } catch (e) {
      setProfile(null);
      setProfileError('Profil belum dapat dimuat. Periksa koneksi lalu coba lagi.');
    } finally {
      setProfileLoading(false);
    }
  }
  async function saveProfile(form) {
    const {
      data,
      error
    } = await supabaseClient.rpc('save_my_profile', {
      p_full_name: form.full_name,
      p_institution: form.institution,
      p_program: form.program,
      p_target_ukom: form.target_ukom || null,
      p_phone: form.phone || null
    });
    if (error) throw error;
    await loadProfile();
    return data;
  }
  async function refreshAccess() {
    if (!authUser?.id) return;
    const {
      data,
      error
    } = await supabaseClient.rpc('get_my_access');
    if (error) {
      setMessage('Status akses belum dapat dimuat. Silakan coba lagi.');
      return;
    }
    setAccess(data);
  }
  async function loadCloudProgress(program) {
    try {
      const {
        data: rows,
        error
      } = await supabaseClient.from('attempts').select('id,mode,started_at,finished_at,score,total_questions,metadata').eq('user_id', authUser.id).order('finished_at', {
        ascending: false
      }).limit(100);
      if (error) throw error;
      const programRows = (rows || []).filter(r => (r.metadata?.program || 'ners') === program);
      const ats = programRows.map(r => ({
        id: r.id,
        mode: r.mode,
        startedAt: r.started_at,
        createdAt: r.finished_at || r.started_at,
        score: Number(r.score || 0),
        total: Number(r.total_questions || 0),
        correct: Number(r.metadata?.correct || 0),
        answered: Number(r.metadata?.answered || 0),
        byArea: r.metadata?.byArea || {},
        wrongIds: r.metadata?.wrongIds || []
      }));
      setAttempts(ats);
      const ids = new Set(programRows.map(r => r.id));
      if (!ids.size) {
        setWrongIds([]);
        return;
      }
      const {
        data: ans,
        error: ansError
      } = await supabaseClient.from('attempt_answers').select('attempt_id,question_id,is_correct,answered_at').in('attempt_id', [...ids]).order('answered_at', {
        ascending: true
      });
      if (ansError) throw ansError;
      const wrong = new Set();
      (ans || []).forEach(r => {
        if (r.is_correct === true) wrong.delete(Number(r.question_id));else if (r.is_correct === false) wrong.add(Number(r.question_id));
      });
      setWrongIds([...wrong]);
    } catch (e) {
      setMessage('Riwayat belum dapat dimuat. Coba lagi beberapa saat lagi.');
    }
  }
  function updateSession(fn) {
    setSession(prev => {
      const next = typeof fn === 'function' ? fn(prev) : fn;
      if (next) {
        save(STORAGE.SESSION, next);
        if (next.sessionId) {
          clearTimeout(window.__ukomProgressTimer);
          window.__ukomProgressTimer = setTimeout(() => {
            const payload = next.questions.map((q, i) => ({
              question_id: Number(q.id),
              selected_index: next.answers[i] === undefined ? null : Number(next.answers[i]),
              is_flagged: next.flagged.includes(i)
            }));
            window.__ukomProgressChain = (window.__ukomProgressChain || Promise.resolve()).then(() => supabaseClient.rpc('save_exam_progress', {
              p_session_id: next.sessionId,
              p_answers: payload
            })).then(({
              error
            }) => {
              if (error) console.warn('Progress sync failed');
            }).catch(() => console.warn('Progress sync failed'));
          }, 350);
        }
      }
      return next;
    });
  }
  async function restoreSession(program) {
    try {
      const {
        data,
        error
      } = await supabaseClient.rpc('resume_exam_session');
      if (error) throw error;
      if (!data) {
        const local = load(STORAGE.SESSION, null);
        if (local?.program === program) localStorage.removeItem(STORAGE.SESSION);
        return;
      }
      const local = load(STORAGE.SESSION, null);
      const restored = sessionFromPayload(data, local);
      if (restored) {
        setSession(restored);
        save(STORAGE.SESSION, restored);
        setView('exam');
        setMessage(local?.sessionId === restored.sessionId ? 'Sesi aktif dipulihkan dari perangkat ini.' : 'Sesi aktif dipulihkan dari server.');
      }
    } catch (e) {
      setMessage('Pemulihan sesi belum berhasil. Anda tetap dapat membuka dashboard dan mencoba lagi.');
    }
  }
  async function startSession(cfg) {
    if (busy.start) return;
    const mode = cfg.mode;
    if (mode !== 'trial' && !access?.premium) {
      setPaywall(true);
      return;
    }
    if (mode === 'trial' && access?.trial_used) {
      setMessage('Trial 20 soal untuk program ini sudah pernah digunakan.');
      return;
    }
    if (mode === 'wrong' && !wrongIds.length) {
      setMessage('Belum ada soal salah untuk diremediasi.');
      return;
    }
    setBusy(x => ({
      ...x,
      start: true
    }));
    setMessage('Menyiapkan sesi aman dari server…');
    try {
      const count = mode === 'tryout' ? 180 : mode === 'trial' ? 20 : Math.min(Number(cfg.count) || 20, 50);
      const {
        data,
        error
      } = await supabaseClient.rpc('start_exam_session', {
        p_mode: mode,
        p_limit: count,
        p_area: mode === 'wrong' || cfg.area === 'Semua' ? null : cfg.area,
        p_ids: mode === 'wrong' ? wrongIds : null,
        p_randomize: cfg.randomize !== false
      });
      if (error) throw error;
      const s = sessionFromPayload(data, load(STORAGE.SESSION, null));
      if (!s?.questions?.length) throw new Error('NO_ACTIVE_QUESTIONS');
      setSession(s);
      save(STORAGE.SESSION, s);
      setView('exam');
      setMessage(data?.resumed ? 'Sesi aktif sebelumnya dipulihkan.' : 'Sesi siap. Jawaban akan tetap tersimpan saat halaman direfresh.');
    } catch (e) {
      const msg = String(e?.message || '');
      if (msg.includes('PREMIUM_REQUIRED')) setPaywall(true);else if (msg.includes('TRIAL_ALREADY_USED')) {
        await refreshAccess();
        setMessage('Trial program ini sudah digunakan.');
      } else setMessage('Sesi belum dapat dimulai. Periksa koneksi lalu coba lagi.');
    } finally {
      setBusy(x => ({
        ...x,
        start: false
      }));
    }
  }
  async function finishSession() {
    if (!session || busy.submit) return;
    setBusy(x => ({
      ...x,
      submit: true
    }));
    setMessage('Menyimpan jawaban dan menghitung hasil…');
    try {
      const payload = session.questions.map((q, i) => ({
        question_id: Number(q.id),
        selected_index: session.answers[i] === undefined ? null : Number(session.answers[i]),
        is_flagged: session.flagged.includes(i)
      }));
      const {
        data,
        error
      } = await supabaseClient.rpc('submit_exam_session', {
        p_session_id: session.sessionId,
        p_answers: payload
      });
      if (error) throw error;
      const a = attemptFromPayload(data);
      localStorage.removeItem(STORAGE.SESSION);
      setSession(null);
      setLastAttempt(a);
      await refreshAccess();
      await loadCloudProgress(profile.program);
      setView('result');
      setMessage('');
    } catch (e) {
      const msg = String(e?.message || '');
      setMessage(msg.includes('SESSION_EXPIRED') ? 'Waktu simulasi telah berakhir. Jawaban belum berhasil dikirim; hubungi bantuan bila masalah berlanjut.' : 'Jawaban belum tersimpan. Jawaban Anda tetap ada di perangkat; periksa koneksi lalu tekan Coba Kirim Lagi.');
    } finally {
      setBusy(x => ({
        ...x,
        submit: false
      }));
    }
  }
  async function openAttempt(attemptId) {
    if (busy.review) return;
    setBusy(x => ({
      ...x,
      review: true
    }));
    setMessage('Memuat pembahasan…');
    try {
      const {
        data,
        error
      } = await supabaseClient.rpc('get_attempt_review', {
        p_attempt_id: attemptId
      });
      if (error) throw error;
      setLastAttempt(attemptFromPayload(data));
      setView('result');
      setMessage('');
    } catch (e) {
      setMessage('Pembahasan riwayat belum dapat dimuat. Silakan coba lagi.');
    } finally {
      setBusy(x => ({
        ...x,
        review: false
      }));
    }
  }
  async function checkout() {
    if (busy.checkout) return;
    setBusy(x => ({
      ...x,
      checkout: true
    }));
    setMessage('Menyiapkan pembayaran aman…');
    try {
      const requestId = crypto.randomUUID();
      const {
        data,
        error
      } = await supabaseClient.functions.invoke(APP_CONFIG.PAYMENT_EDGE_FUNCTION, {
        body: {
          program: profile.program,
          plan: 'launch_30',
          request_id: requestId
        }
      });
      if (error) throw error;
      if (data?.redirect_url) {
        setMessage('Mengalihkan ke halaman pembayaran Midtrans…');
        window.location.assign(data.redirect_url);
        return;
      }
      throw new Error(data?.error || 'PAYMENT_REDIRECT_MISSING');
    } catch (e) {
      console.error('Checkout error', e);
      setMessage('Pembayaran belum dapat diproses. Silakan tunggu sebentar lalu coba lagi.');
    } finally {
      setBusy(x => ({
        ...x,
        checkout: false
      }));
    }
  }
  if (authLoading) return React.createElement(Splash, null);
  if (!authUser) return React.createElement(Marketing, {
    onLogin: googleLogin
  });
  if (profileLoading) return React.createElement(Splash, {
    text: "Memuat profil mahasiswa\u2026"
  });
  if (profileError && !profile) return React.createElement(LoadError, {
    message: profileError,
    onRetry: loadProfile,
    onSignOut: signOut
  });
  if (!profile) return React.createElement(LoadError, {
    message: "Profil tidak ditemukan.",
    onRetry: loadProfile,
    onSignOut: signOut
  });
  const complete = profile.full_name && profile.institution && ['ners', 'd3', 'bidan'].includes(profile.program);
  if (!complete) return React.createElement(Onboarding, {
    initial: profile,
    user: authUser,
    onSave: saveProfile
  });
  const latest = attempts[0],
    avg = attempts.length ? (attempts.reduce((a, b) => a + b.score, 0) / attempts.length).toFixed(1) : 0,
    best = attempts.length ? Math.max(...attempts.map(a => a.score)) : 0;
  const currentAreas = areasForProgram(profile.program);
  const aggregate = {};
  currentAreas.forEach(a => aggregate[a] = {
    correct: 0,
    total: 0
  });
  attempts.slice(0, 10).forEach(at => Object.entries(at.byArea || {}).forEach(([a, v]) => {
    aggregate[a] ||= {
      correct: 0,
      total: 0
    };
    aggregate[a].correct += v.correct;
    aggregate[a].total += v.total;
  }));
  const weakest = Object.entries(aggregate).filter(([, v]) => v.total > 0).sort((a, b) => a[1].correct / a[1].total - b[1].correct / b[1].total)[0]?.[0];
  return React.createElement("div", {
    className: "min-h-screen"
  }, view !== 'exam' && React.createElement(TopNav, {
    profile: profile,
    access: access,
    setView: setView,
    onSignOut: signOut
  }), view === 'dashboard' && React.createElement(Dashboard, {
    profile: profile,
    access: access,
    attempts: attempts,
    latest: latest,
    avg: avg,
    best: best,
    aggregate: aggregate,
    weakest: weakest,
    wrongCount: wrongIds.length,
    message: message,
    onTrial: () => startSession({
      mode: 'trial',
      area: 'Semua',
      count: 20,
      randomize: true
    }),
    onPremium: () => setView('setup'),
    onWrong: () => startSession({
      mode: 'wrong',
      area: 'Semua',
      count: 20,
      randomize: true
    }),
    onPricing: () => setPaywall(true),
    onRefresh: async () => {
      await refreshAccess();
      await loadCloudProgress(profile.program);
    },
    setView: setView
  }), view === 'setup' && React.createElement(Setup, {
    setup: setup,
    setSetup: setSetup,
    areas: currentAreas,
    premium: access?.premium,
    wrongCount: wrongIds.length,
    onStart: () => startSession(setup),
    onBack: () => setView('dashboard'),
    onPricing: () => setPaywall(true),
    busy: busy.start,
    message: message
  }), view === 'exam' && session && React.createElement(Exam, {
    session: session,
    setSession: updateSession,
    onFinish: finishSession,
    favorites: favorites,
    setFavorites: setFavorites,
    busy: busy.submit,
    message: message
  }), view === 'result' && lastAttempt && React.createElement(Result, {
    attempt: lastAttempt,
    onDashboard: () => setView('dashboard'),
    onWeak: a => {
      setSetup({
        mode: 'learn',
        area: a,
        count: 20,
        randomize: true
      });
      setView('setup');
    }
  }), view === 'history' && React.createElement(History, {
    attempts: attempts,
    onBack: () => setView('dashboard'),
    onOpen: openAttempt,
    busy: busy.review
  }), view === 'profile' && React.createElement(Profile, {
    profile: profile,
    onSave: async f => {
      await saveProfile(f);
      setView('dashboard');
    },
    onBack: () => setView('dashboard')
  }), view === 'help' && React.createElement(Help, {
    onBack: () => setView('dashboard')
  }), paywall && React.createElement(Pricing, {
    onClose: () => setPaywall(false),
    onCheckout: checkout,
    onRefresh: refreshAccess,
    program: profile.program,
    message: message,
    busy: busy.checkout
  }));
}
function LoadError({
  message,
  onRetry,
  onSignOut
}) {
  return React.createElement("main", {
    className: "min-h-screen bg-sky-50 grid place-items-center p-4"
  }, React.createElement("div", {
    className: "max-w-md w-full bg-white border border-sky-100 rounded-3xl p-7 text-center shadow-sm",
    role: "alert"
  }, React.createElement("div", {
    className: "text-3xl"
  }, "\u26A0\uFE0F"), React.createElement("h1", {
    className: "text-xl font-black mt-3"
  }, "Data belum dapat dimuat"), React.createElement("p", {
    className: "text-slate-600 mt-2"
  }, message), React.createElement("button", {
    onClick: onRetry,
    className: "mt-5 w-full py-3 rounded-xl bg-sky-700 text-white font-black"
  }, "Coba Lagi"), React.createElement("button", {
    onClick: onSignOut,
    className: "mt-2 w-full py-3 rounded-xl bg-slate-100 font-bold"
  }, "Keluar")));
}
function Splash({
  text = 'Memuat UKOM Health Pro…'
}) {
  return React.createElement("div", {
    className: "min-h-screen grid place-items-center bg-gradient-to-br from-sky-50 to-blue-100 text-slate-900"
  }, React.createElement("div", {
    className: "text-center"
  }, React.createElement("div", {
    className: "w-16 h-16 rounded-2xl bg-gradient-to-br from-sky-400 to-blue-600 text-white grid place-items-center font-black text-2xl mx-auto shadow-xl shadow-sky-200"
  }, "H+"), React.createElement("div", {
    className: "font-black mt-4"
  }, text)));
}
function Marketing({
  onLogin
}) {
  const faqs = [['Apakah saya harus langsung membeli Premium?', 'Tidak. Pengguna baru dapat mencoba Trial 20 soal terlebih dahulu. Trial tersedia satu kali untuk setiap program yang dipilih.'], ['Apa perbedaan Trial, Latihan, dan Simulasi?', 'Trial berisi 20 soal gratis. Setelah Premium aktif, Latihan dapat difokuskan per area, sedangkan Simulasi menggunakan 180 soal dengan waktu 180 menit.'], ['Apakah akses Premium berlaku untuk semua program?', 'Tidak. Akses Premium berlaku per program selama 30 hari. Program Profesi Ners, D3 Keperawatan, dan Profesi Bidan memiliki bank soal masing-masing.'], ['Bagaimana pembayaran diaktifkan?', 'Klik Buka Premium, selesaikan pembayaran melalui halaman Midtrans, lalu kembali ke aplikasi dan pilih Cek Status Akses. Akses aktif otomatis setelah pembayaran terverifikasi.'], ['Kapan pembahasan jawaban muncul?', 'Kunci dan pembahasan A–E baru ditampilkan setelah sesi selesai dan jawaban berhasil disimpan. Ini membantu menjaga integritas latihan.'], ['Apakah soal di platform ini soal resmi UKOM?', 'Bukan. UKOM Health Pro adalah platform latihan independen untuk membantu persiapan, analisis kompetensi, dan clinical reasoning.']];
  return React.createElement("div", {
    className: "min-h-screen bg-gradient-to-b from-sky-50 via-white to-sky-50 text-slate-900"
  }, React.createElement("nav", {
    className: "fixed top-0 inset-x-0 z-50 border-b border-sky-100 bg-white/90 backdrop-blur-xl"
  }, React.createElement("div", {
    className: "max-w-7xl mx-auto h-16 px-3 sm:px-4 md:px-8 flex items-center justify-between"
  }, React.createElement("div", {
    className: "flex items-center gap-2 sm:gap-3"
  }, React.createElement("div", {
    className: "w-10 h-10 rounded-xl bg-gradient-to-br from-sky-400 to-blue-600 text-white grid place-items-center font-black shadow-lg shadow-sky-200"
  }, "H+"), React.createElement("div", {
    className: "hidden sm:block font-black"
  }, "UKOM Health Pro")), React.createElement("div", {
    className: "hidden md:flex gap-7 text-sm text-slate-600 font-semibold"
  }, React.createElement("a", {
    className: "hover:text-sky-600",
    href: "#cara-pakai"
  }, "Cara Pakai"), React.createElement("a", {
    className: "hover:text-sky-600",
    href: "#fitur"
  }, "Fitur"), React.createElement("a", {
    className: "hover:text-sky-600",
    href: "#program"
  }, "Program"), React.createElement("a", {
    className: "hover:text-sky-600",
    href: "#harga"
  }, "Harga"), React.createElement("a", {
    className: "hover:text-sky-600",
    href: "#faq"
  }, "FAQ")), React.createElement("div", {
    className: "flex items-center gap-2"
  }, React.createElement("a", {
    href: "#faq",
    className: "md:hidden px-3 py-2 rounded-xl text-sky-700 bg-sky-50 font-black text-sm"
  }, "FAQ"), React.createElement("button", {
    onClick: onLogin,
    className: "px-3 sm:px-4 py-2.5 rounded-xl bg-sky-700 hover:bg-sky-800 text-white font-black shadow-lg shadow-sky-200"
  }, "Masuk / Daftar")))), React.createElement("section", {
    className: "hero-grid pt-28 pb-16 md:pb-20 overflow-hidden bg-gradient-to-br from-sky-50 via-white to-blue-50"
  }, React.createElement("div", {
    className: "max-w-7xl mx-auto px-4 md:px-8 grid lg:grid-cols-2 gap-10 lg:gap-14 items-center"
  }, React.createElement("div", null, React.createElement("div", {
    className: "inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-sky-200 bg-sky-100 text-sky-700 text-xs font-black"
  }, "PROFESI NERS \u2022 D3 KEPERAWATAN \u2022 PROFESI BIDAN"), React.createElement("h1", {
    className: "text-4xl md:text-6xl lg:text-7xl font-black tracking-tight leading-[1.02] mt-6"
  }, "Kenali kelemahanmu. ", React.createElement("span", {
    className: "text-transparent bg-clip-text bg-gradient-to-r from-sky-500 to-blue-600"
  }, "Latih clinical reasoning-mu.")), React.createElement("p", {
    className: "text-base md:text-lg text-slate-600 mt-6 max-w-2xl leading-8"
  }, "Simulasi vignette, analisis kompetensi, pembahasan A\u2013E, dan latihan terarah untuk membantu persiapan UKOM secara sistematis."), React.createElement("div", {
    className: "flex flex-col sm:flex-row gap-3 mt-8"
  }, React.createElement("button", {
    onClick: onLogin,
    className: "px-6 py-4 rounded-2xl bg-sky-700 hover:bg-sky-800 text-white font-black shadow-xl shadow-sky-200"
  }, "Coba 20 Soal Gratis"), React.createElement("a", {
    href: "#cara-pakai",
    className: "px-6 py-4 rounded-2xl border border-sky-200 bg-white text-sky-700 font-black text-center"
  }, "Lihat Cara Menggunakan \u2192")), React.createElement("div", {
    className: "flex flex-wrap gap-x-5 gap-y-2 mt-8 text-sm text-slate-500"
  }, React.createElement("span", null, "\u2713 180 soal per program"), React.createElement("span", null, "\u2713 Server-side scoring"), React.createElement("span", null, "\u2713 Pembahasan A\u2013E"))), React.createElement("div", {
    className: "orb-wrap relative min-h-[330px] md:min-h-[430px] grid place-items-center"
  }, React.createElement("div", {
    className: "orb"
  }), React.createElement("div", {
    className: "float-card a"
  }, React.createElement("div", {
    className: "text-[9px] text-sky-200 font-black"
  }, "CONTOH HASIL"), React.createElement("div", {
    className: "text-[10px] text-cyan-200 font-black mt-1"
  }, "KOMPETENSI KUAT"), React.createElement("div", {
    className: "text-xl font-black"
  }, "82%")), React.createElement("div", {
    className: "float-card b"
  }, React.createElement("div", {
    className: "text-[9px] text-sky-200 font-black"
  }, "CONTOH HASIL"), React.createElement("div", {
    className: "text-[10px] text-rose-200 font-black mt-1"
  }, "AREA PRIORITAS"), React.createElement("div", {
    className: "font-black"
  }, "Fokus berikutnya \xB7 48%")), React.createElement("div", {
    className: "float-card c"
  }, React.createElement("div", {
    className: "text-[10px] text-sky-200 font-black"
  }, "SIMULASI"), React.createElement("div", {
    className: "font-black"
  }, "180 soal \xB7 180 menit"))))), React.createElement("section", {
    id: "cara-pakai",
    className: "py-16 md:py-20 bg-white"
  }, React.createElement("div", {
    className: "max-w-6xl mx-auto px-4 md:px-8"
  }, React.createElement("div", {
    className: "max-w-2xl"
  }, React.createElement("div", {
    className: "text-xs font-black text-sky-600"
  }, "MULAI DALAM 4 LANGKAH"), React.createElement("h2", {
    className: "text-3xl md:text-5xl font-black mt-3"
  }, "Baru pertama kali? Ikuti alur ini."), React.createElement("p", {
    className: "text-slate-500 mt-4 leading-7"
  }, "Tidak perlu memahami semua menu sejak awal. Selesaikan langkah berikut secara berurutan.")), React.createElement("div", {
    className: "grid sm:grid-cols-2 lg:grid-cols-4 gap-4 mt-9"
  }, [['1', 'Masuk & pilih program', 'Login dengan Google, lengkapi nama dan institusi, lalu pilih Profesi Ners, D3 Keperawatan, atau Profesi Bidan.'], ['2', 'Coba Trial 20 soal', 'Gunakan trial untuk mengenal format vignette, navigasi soal, tanda ragu, dan cara submit.'], ['3', 'Aktifkan Premium', 'Jika ingin melanjutkan, pilih Buka Premium dan selesaikan pembayaran Midtrans. Premium aktif selama 30 hari per program.'], ['4', 'Latihan & evaluasi', 'Pilih latihan per area atau Simulasi 180 soal. Setelah submit, pelajari skor, area lemah, dan pembahasan A–E.']].map(([n, t, d]) => React.createElement("div", {
    key: n,
    className: "mobile-app-card rounded-3xl border border-sky-100 bg-sky-50/70 p-6"
  }, React.createElement("div", {
    className: "w-11 h-11 rounded-2xl bg-sky-500 text-white grid place-items-center font-black"
  }, n), React.createElement("h3", {
    className: "font-black text-lg mt-5"
  }, t), React.createElement("p", {
    className: "text-sm text-slate-600 leading-6 mt-2"
  }, d)))))), React.createElement("section", {
    id: "program",
    className: "py-16 md:py-20 bg-sky-50 text-slate-900"
  }, React.createElement("div", {
    className: "max-w-6xl mx-auto px-4 md:px-8"
  }, React.createElement("div", {
    className: "text-center"
  }, React.createElement("div", {
    className: "text-xs font-black text-sky-600"
  }, "PILIH PROGRAMMU"), React.createElement("h2", {
    className: "text-3xl md:text-5xl font-black mt-3"
  }, "Satu platform, tiga jalur UKOM.")), React.createElement("div", {
    className: "grid md:grid-cols-3 gap-6 mt-10"
  }, React.createElement(ProgramCard, {
    icon: "\uD83E\uDE7A",
    title: "Profesi Ners",
    desc: "Simulasi dan analitik khusus calon Ners."
  }), React.createElement(ProgramCard, {
    icon: "\uD83C\uDFE5",
    title: "D3 Keperawatan",
    desc: "180 vignette dengan fokus implementasi dan procedural knowledge."
  }), React.createElement(ProgramCard, {
    icon: "\uD83E\uDD31",
    title: "Profesi Bidan",
    desc: "180 vignette kebidanan berbasis clinical reasoning sepanjang siklus reproduksi."
  })))), React.createElement("section", {
    id: "fitur",
    className: "py-16 md:py-20 bg-white text-slate-900"
  }, React.createElement("div", {
    className: "max-w-7xl mx-auto px-4 md:px-8"
  }, React.createElement("div", {
    className: "grid md:grid-cols-3 gap-5"
  }, React.createElement(Feature, {
    title: "Simulasi Realistis",
    text: "180 soal, timer, randomisasi opsi, tanda ragu, dan review setelah submit."
  }), React.createElement(Feature, {
    title: "Analisis Kompetensi",
    text: "Lihat performa per area dan temukan fokus belajar berikutnya."
  }), React.createElement(Feature, {
    title: "Pembahasan A\u2013E",
    text: "Pelajari alasan jawaban benar dan alasan setiap distraktor tidak tepat setelah sesi selesai."
  })))), React.createElement("section", {
    id: "harga",
    className: "py-16 md:py-20 bg-gradient-to-br from-sky-600 to-blue-700 text-white"
  }, React.createElement("div", {
    className: "max-w-5xl mx-auto px-4 md:px-8 text-center"
  }, React.createElement("div", {
    className: "text-xs font-black text-sky-100"
  }, "PROMO LAUNCHING"), React.createElement("h2", {
    className: "text-4xl md:text-5xl font-black mt-3"
  }, "Belajar 30 hari. Bayar sekali."), React.createElement("div", {
    className: "mt-8 inline-block p-8 rounded-[2rem] border border-white/20 bg-white/10 backdrop-blur min-w-[300px] sm:min-w-[320px]"
  }, React.createElement("div", {
    className: "text-sky-100 line-through text-xl"
  }, money(APP_CONFIG.NORMAL_PRICE)), React.createElement("div", {
    className: "text-5xl sm:text-6xl font-black mt-1"
  }, money(APP_CONFIG.PROMO_PRICE)), React.createElement("div", {
    className: "text-sky-50 mt-2"
  }, "/ program / 30 hari"), React.createElement("button", {
    onClick: onLogin,
    className: "mt-7 w-full py-4 rounded-2xl bg-white text-sky-700 font-black"
  }, "Mulai dari Trial Gratis")))), React.createElement("section", {
    id: "faq",
    className: "py-16 md:py-20 bg-sky-50"
  }, React.createElement("div", {
    className: "max-w-4xl mx-auto px-4 md:px-8"
  }, React.createElement("div", {
    className: "text-center"
  }, React.createElement("div", {
    className: "text-xs font-black text-sky-600"
  }, "FAQ & BANTUAN"), React.createElement("h2", {
    className: "text-3xl md:text-5xl font-black mt-3"
  }, "Pertanyaan yang paling sering ditanyakan.")), React.createElement("div", {
    className: "space-y-3 mt-9"
  }, faqs.map(([q, a], i) => React.createElement("details", {
    key: i,
    className: "group rounded-2xl border border-sky-100 bg-white p-5 shadow-sm"
  }, React.createElement("summary", {
    className: "cursor-pointer list-none flex items-center justify-between gap-4 font-black"
  }, React.createElement("span", null, q), React.createElement("span", {
    className: "w-8 h-8 rounded-full bg-sky-50 text-sky-600 grid place-items-center group-open:rotate-45 transition"
  }, "+")), React.createElement("p", {
    className: "text-slate-600 leading-7 mt-4 pr-8"
  }, a)))), React.createElement("div", {
    className: "text-center mt-8"
  }, React.createElement("button", {
    onClick: onLogin,
    className: "px-6 py-3.5 rounded-2xl bg-sky-700 text-white font-black"
  }, "Masuk ke UKOM Health Pro")))), React.createElement("footer", {
    className: "py-10 bg-white border-t border-sky-100 text-sm text-slate-500 px-4"
  }, React.createElement("div", {
    className: "max-w-6xl mx-auto flex flex-col md:flex-row gap-5 items-center justify-between"
  }, React.createElement("div", {
    className: "text-center md:text-left"
  }, React.createElement("div", {
    className: "font-black text-slate-700"
  }, "UKOM Health Pro"), React.createElement("div", {
    className: "mt-1"
  }, "Bank soal latihan independen, bukan soal resmi UKOM Nasional.")), React.createElement("nav", {
    "aria-label": "Informasi layanan",
    className: "flex flex-wrap justify-center gap-x-5 gap-y-2 font-semibold"
  }, React.createElement("a", {
    className: "hover:text-sky-700",
    href: "privacy.html"
  }, "Kebijakan Privasi"), React.createElement("a", {
    className: "hover:text-sky-700",
    href: "terms.html"
  }, "Syarat Layanan"), React.createElement("a", {
    className: "hover:text-sky-700",
    href: "refund.html"
  }, "Pembayaran & Refund"), React.createElement("a", {
    className: "hover:text-sky-700",
    href: "support.html"
  }, "Bantuan")))));
}
function ProgramCard({
  icon,
  title,
  desc
}) {
  return React.createElement("div", {
    className: "tilt mobile-app-card rounded-3xl border border-sky-100 p-7 bg-gradient-to-br from-white to-sky-50 shadow-sm"
  }, React.createElement("div", {
    className: "text-4xl"
  }, icon), React.createElement("h3", {
    className: "text-2xl font-black mt-5"
  }, title), React.createElement("p", {
    className: "text-slate-500 mt-2"
  }, desc));
}
function Feature({
  title,
  text
}) {
  return React.createElement("div", {
    className: "tilt mobile-app-card rounded-3xl bg-white border border-sky-100 p-7 shadow-sm"
  }, React.createElement("div", {
    className: "w-11 h-11 rounded-xl bg-sky-100 text-sky-600 grid place-items-center font-black"
  }, "\u2726"), React.createElement("h3", {
    className: "text-xl font-black mt-5"
  }, title), React.createElement("p", {
    className: "text-slate-500 mt-2 leading-6"
  }, text));
}
function Onboarding({
  initial,
  user,
  onSave
}) {
  const [f, setF] = useState({
      full_name: initial.full_name || user.user_metadata?.full_name || user.user_metadata?.name || '',
      institution: initial.institution || '',
      program: initial.program || '',
      target_ukom: initial.target_ukom || '2026',
      phone: initial.phone || ''
    }),
    [busy, setBusy] = useState(false),
    [err, setErr] = useState('');
  async function submit() {
    setBusy(true);
    setErr('');
    try {
      await onSave(f);
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }
  return React.createElement("main", {
    className: "min-h-screen bg-gradient-to-br from-sky-50 to-blue-100 text-slate-900 grid place-items-center p-4"
  }, React.createElement("div", {
    className: "w-full max-w-2xl bg-white text-slate-900 rounded-[2rem] p-7 md:p-10 shadow-2xl"
  }, React.createElement("div", {
    className: "text-xs font-black text-sky-600"
  }, "SELAMAT DATANG"), React.createElement("h1", {
    className: "text-3xl font-black mt-2"
  }, "Lengkapi profil UKOM-mu"), React.createElement("p", {
    className: "text-slate-500 mt-2"
  }, "Data ini digunakan untuk menyesuaikan bank soal dan analitik."), React.createElement("div", {
    className: "grid md:grid-cols-2 gap-5 mt-7"
  }, React.createElement(Field, {
    label: "Nama lengkap",
    value: f.full_name,
    onChange: v => setF({
      ...f,
      full_name: v
    })
  }), React.createElement(Field, {
    label: "Institusi",
    value: f.institution,
    onChange: v => setF({
      ...f,
      institution: v
    }),
    placeholder: "Universitas / Poltekkes / STIKes"
  }), React.createElement("label", {
    className: "block md:col-span-2"
  }, React.createElement("span", {
    className: "text-sm font-black"
  }, "Program Studi"), React.createElement("div", {
    className: "grid md:grid-cols-3 gap-3 mt-2"
  }, [['ners', 'Profesi Ners', '🩺'], ['d3', 'D3 Keperawatan', '🏥'], ['bidan', 'Profesi Bidan', '🤱']].map(([id, t, ico]) => React.createElement("button", {
    key: id,
    type: "button",
    onClick: () => setF({
      ...f,
      program: id
    }),
    className: `text-left p-4 rounded-2xl border-2 ${f.program === id ? 'border-sky-500 bg-sky-50' : 'border-slate-200'}`
  }, React.createElement("span", {
    className: "text-2xl"
  }, ico), React.createElement("div", {
    className: "font-black mt-2"
  }, t))))), React.createElement(Field, {
    label: "Target UKOM",
    value: f.target_ukom,
    onChange: v => setF({
      ...f,
      target_ukom: v
    })
  }), React.createElement(Field, {
    label: "WhatsApp (opsional)",
    value: f.phone,
    onChange: v => setF({
      ...f,
      phone: v
    })
  })), err && React.createElement("div", {
    className: "mt-4 p-3 rounded-xl bg-rose-50 text-rose-700 text-sm"
  }, err), React.createElement("button", {
    disabled: busy || !f.full_name || !f.institution || !f.program,
    onClick: submit,
    className: "mt-7 w-full py-4 rounded-2xl bg-slate-900 text-white font-black disabled:opacity-40"
  }, busy ? 'Menyimpan…' : 'Masuk ke Dashboard')));
}
function Field({
  label,
  value,
  onChange,
  placeholder
}) {
  return React.createElement("label", {
    className: "block"
  }, React.createElement("span", {
    className: "text-sm font-black"
  }, label), React.createElement("input", {
    value: value || '',
    onChange: e => onChange(e.target.value),
    placeholder: placeholder || '',
    className: "mt-2 w-full p-3.5 rounded-xl border border-slate-300 outline-none focus:ring-2 ring-indigo-200"
  }));
}
function TopNav({
  profile,
  access,
  setView,
  onSignOut
}) {
  return React.createElement("header", {
    className: "sticky top-0 z-40 bg-white/95 backdrop-blur border-b border-sky-100 no-print"
  }, React.createElement("div", {
    className: "max-w-7xl mx-auto h-16 px-3 sm:px-4 md:px-8 flex items-center justify-between"
  }, React.createElement("button", {
    onClick: () => setView('dashboard'),
    className: "flex items-center gap-2 sm:gap-3"
  }, React.createElement("div", {
    className: "w-10 h-10 rounded-xl bg-gradient-to-br from-sky-400 to-blue-600 text-white grid place-items-center font-black shadow-md shadow-sky-100"
  }, "H+"), React.createElement("div", {
    className: "text-left hidden sm:block"
  }, React.createElement("div", {
    className: "font-black"
  }, "UKOM Health Pro"), React.createElement("div", {
    className: "text-[11px] text-slate-400 font-bold"
  }, programLabel(profile.program)))), React.createElement("div", {
    className: "flex items-center gap-1 sm:gap-2"
  }, React.createElement("span", {
    className: `hidden md:inline-flex px-3 py-1 rounded-full text-xs font-black ${access?.premium ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`
  }, access?.premium ? 'PRO AKTIF' : 'FREE'), React.createElement("button", {
    onClick: () => setView('history'),
    className: "hidden sm:block px-3 py-2 rounded-xl font-bold hover:bg-sky-50"
  }, "Riwayat"), React.createElement("button", {
    onClick: () => setView('help'),
    "aria-label": "Bantuan dan FAQ",
    className: "w-10 h-10 rounded-xl bg-sky-50 text-sky-700 font-black"
  }, "?"), React.createElement("button", {
    onClick: () => setView('profile'),
    className: "px-3 py-2 rounded-xl bg-slate-100 font-bold max-w-[105px] truncate"
  }, profile.full_name.split(' ')[0]), React.createElement("button", {
    onClick: onSignOut,
    className: "px-2 sm:px-3 py-2 rounded-xl text-rose-600 font-bold"
  }, React.createElement("span", {
    className: "hidden sm:inline"
  }, "Keluar"), React.createElement("span", {
    className: "sm:hidden"
  }, "\u2197")))));
}
function Dashboard({
  profile,
  access,
  attempts,
  latest,
  avg,
  best,
  aggregate,
  weakest,
  wrongCount,
  message,
  onTrial,
  onPremium,
  onWrong,
  onPricing,
  onRefresh,
  setView
}) {
  const r = readiness(latest?.score || 0);
  return React.createElement("main", {
    className: "max-w-7xl mx-auto px-4 md:px-8 py-8 space-y-7"
  }, React.createElement("section", {
    className: "rounded-[2rem] bg-gradient-to-br from-sky-600 via-sky-500 to-blue-700 text-white p-7 md:p-10 relative overflow-hidden shadow-xl shadow-sky-100"
  }, React.createElement("div", {
    className: "absolute right-0 top-0 w-80 h-80 bg-indigo-500/20 blur-3xl rounded-full"
  }), React.createElement("div", {
    className: "relative grid lg:grid-cols-[1.3fr,.7fr] gap-8 items-center"
  }, React.createElement("div", null, React.createElement("div", {
    className: "flex flex-wrap gap-2"
  }, React.createElement("span", {
    className: "px-3 py-1 rounded-full bg-white/10 text-xs font-black"
  }, programLabel(profile.program)), React.createElement("span", {
    className: `px-3 py-1 rounded-full text-xs font-black ${access?.premium ? 'bg-emerald-400/20 text-emerald-200' : 'bg-amber-400/20 text-amber-200'}`
  }, access?.premium ? 'Premium aktif' : 'Free account'), access?.premium && access?.expires_at && React.createElement("span", {
    className: "px-3 py-1 rounded-full bg-white/10 text-xs font-bold"
  }, "Aktif s.d. ", fmtDateID(access.expires_at))), React.createElement("h1", {
    className: "text-3xl md:text-5xl font-black mt-5"
  }, "Halo, ", profile.full_name.split(' ')[0], " \uD83D\uDC4B"), React.createElement("p", {
    className: "text-slate-300 mt-3"
  }, "Latihan, ukur kelemahan, lalu fokuskan belajar pada area yang paling membutuhkan penguatan."), React.createElement("div", {
    className: "flex flex-wrap gap-3 mt-7"
  }, !access?.trial_used && React.createElement("button", {
    onClick: onTrial,
    className: "px-6 py-3.5 rounded-xl bg-white text-sky-700 font-black"
  }, "Coba 20 Soal Gratis"), React.createElement("button", {
    onClick: access?.premium ? onPremium : onPricing,
    className: "px-6 py-3.5 rounded-xl bg-blue-700 font-black"
  }, access?.premium ? 'Mulai Latihan / Tryout' : '🔒 Buka Premium'), access?.premium && wrongCount > 0 && React.createElement("button", {
    onClick: onWrong,
    className: "px-6 py-3.5 rounded-xl bg-white/10 font-bold"
  }, "Ulangi ", wrongCount, " Soal Salah"))), React.createElement("div", {
    className: "bg-white/10 border border-white/10 rounded-3xl p-6"
  }, React.createElement("div", {
    className: "text-sm text-slate-300"
  }, "Kesiapan tryout terakhir"), React.createElement("div", {
    className: "text-6xl font-black mt-2"
  }, latest ? latest.score : '–', React.createElement("span", {
    className: "text-2xl"
  }, "%")), React.createElement("div", {
    className: "font-black mt-2"
  }, latest ? r.label : 'Belum ada data'), React.createElement("div", {
    className: "text-xs text-slate-400 mt-3"
  }, "Indikator internal platform, bukan keputusan kelulusan resmi.")))), React.createElement("section", {
    className: "grid sm:grid-cols-2 lg:grid-cols-4 gap-4"
  }, React.createElement(Stat, {
    label: "Attempt selesai",
    value: attempts.length
  }), React.createElement(Stat, {
    label: "Rata-rata",
    value: attempts.length ? avg + '%' : '–'
  }), React.createElement(Stat, {
    label: "Skor terbaik",
    value: attempts.length ? best + '%' : '–'
  }), React.createElement(Stat, {
    label: "Soal perlu diulang",
    value: wrongCount
  })), !access?.premium && React.createElement("section", {
    className: "rounded-3xl bg-gradient-to-r from-sky-500 to-blue-600 text-white p-6 md:p-8 flex flex-col md:flex-row items-center justify-between gap-5"
  }, React.createElement("div", null, React.createElement("div", {
    className: "text-xs font-black text-indigo-100"
  }, "PROMO LAUNCHING"), React.createElement("div", {
    className: "text-2xl font-black mt-1"
  }, React.createElement("span", {
    className: "line-through opacity-70 mr-2"
  }, money(APP_CONFIG.NORMAL_PRICE)), money(APP_CONFIG.PROMO_PRICE)), React.createElement("div", {
    className: "text-sm text-white/80 mt-1"
  }, "Akses 30 hari untuk ", programLabel(profile.program), ".")), React.createElement("button", {
    onClick: onPricing,
    className: "px-6 py-3.5 rounded-xl bg-white text-slate-950 font-black"
  }, "Aktifkan Premium")), React.createElement("section", {
    className: "grid lg:grid-cols-[1.25fr,.75fr] gap-6"
  }, React.createElement("div", {
    className: "bg-white border border-slate-200 rounded-3xl p-6 md:p-8"
  }, React.createElement("div", {
    className: "flex justify-between"
  }, React.createElement("div", null, React.createElement("h2", {
    className: "text-xl font-black"
  }, "Peta Kompetensi"), React.createElement("p", {
    className: "text-sm text-slate-500"
  }, "Agregasi 10 attempt terakhir.")), weakest && React.createElement("span", {
    className: "text-xs bg-rose-50 text-rose-600 font-black px-3 py-2 rounded-xl h-fit"
  }, "Fokus: ", weakest)), React.createElement("div", {
    className: "space-y-4 mt-6"
  }, areasForProgram(profile.program).map(a => {
    const v = aggregate[a] || {
      correct: 0,
      total: 0
    };
    if (!v.total) return null;
    const p = Math.round(100 * v.correct / v.total);
    return React.createElement("div", {
      key: a
    }, React.createElement("div", {
      className: "flex justify-between text-sm font-bold"
    }, React.createElement("span", null, a), React.createElement("span", null, p, "%")), React.createElement("div", {
      className: "h-2.5 bg-slate-100 rounded-full mt-2 overflow-hidden"
    }, React.createElement("div", {
      className: `${p >= 75 ? 'bg-emerald-500' : p >= 60 ? 'bg-amber-400' : 'bg-rose-500'} h-full`,
      style: {
        width: p + '%'
      }
    })));
  }))), React.createElement("div", {
    className: "bg-white border border-slate-200 rounded-3xl p-6"
  }, React.createElement("h2", {
    className: "text-xl font-black"
  }, "Akun & Akses"), React.createElement("div", {
    className: "mt-5 p-4 rounded-2xl bg-slate-50"
  }, React.createElement("div", {
    className: "text-xs font-black text-slate-400"
  }, "INSTITUSI"), React.createElement("div", {
    className: "font-black mt-1"
  }, profile.institution)), React.createElement("div", {
    className: "mt-3 p-4 rounded-2xl bg-slate-50"
  }, React.createElement("div", {
    className: "text-xs font-black text-slate-400"
  }, "TRIAL"), React.createElement("div", {
    className: "font-black mt-1"
  }, access?.trial_used ? 'Sudah digunakan' : '20 soal tersedia')), React.createElement("button", {
    onClick: onRefresh,
    className: "mt-4 w-full py-3 rounded-xl bg-slate-900 text-white font-black"
  }, "Cek Status Akses"))), message && React.createElement("div", {
    className: "p-4 rounded-2xl bg-slate-100 text-sm text-slate-600"
  }, message));
}
function Stat({
  label,
  value
}) {
  return React.createElement("div", {
    className: "bg-white rounded-2xl border border-slate-200 p-5"
  }, React.createElement("div", {
    className: "text-3xl font-black"
  }, value), React.createElement("div", {
    className: "font-bold mt-1"
  }, label));
}
function Setup({
  setup,
  setSetup,
  areas,
  premium,
  wrongCount,
  onStart,
  onBack,
  onPricing,
  busy,
  message
}) {
  if (!premium) return React.createElement("main", {
    className: "max-w-3xl mx-auto px-4 py-12"
  }, React.createElement("button", {
    onClick: onBack,
    className: "font-bold text-slate-500"
  }, "\u2190 Dashboard"), React.createElement("div", {
    className: "mt-6 bg-white rounded-3xl border p-8 text-center"
  }, React.createElement("div", {
    className: "text-4xl"
  }, "\uD83D\uDD12"), React.createElement("h1", {
    className: "text-3xl font-black mt-4"
  }, "Fitur Premium"), React.createElement("p", {
    className: "text-slate-500 mt-2"
  }, "Aktifkan paket untuk latihan per area dan simulasi 180 soal."), React.createElement("button", {
    onClick: onPricing,
    className: "mt-6 px-6 py-3.5 rounded-xl bg-sky-700 text-white font-black"
  }, "Lihat Promo")));
  return React.createElement("main", {
    className: "max-w-4xl mx-auto px-4 py-10"
  }, React.createElement("button", {
    onClick: onBack,
    className: "font-bold text-slate-500"
  }, "\u2190 Dashboard"), React.createElement("div", {
    className: "bg-white border rounded-[2rem] p-7 md:p-9 mt-5"
  }, React.createElement("h1", {
    className: "text-3xl font-black"
  }, "Pilih Mode"), React.createElement("p", {
    className: "text-slate-500 mt-2"
  }, "Sesi dibuat dan dikunci di server. Jika halaman direfresh, sesi yang sama akan dipulihkan."), React.createElement("div", {
    className: "grid md:grid-cols-3 gap-4 mt-7"
  }, [['tryout', 'Simulasi 180', '180 soal · 180 menit · deadline server'], ['learn', 'Latihan Terarah', '10–50 soal per area'], ['wrong', 'Soal Salah Saya', `${wrongCount} soal untuk remediasi`]].map(([id, t, d]) => React.createElement("button", {
    key: id,
    type: "button",
    disabled: busy || id === 'wrong' && !wrongCount,
    onClick: () => setSetup({
      ...setup,
      mode: id,
      area: id === 'wrong' ? 'Semua' : setup.area
    }),
    "aria-pressed": setup.mode === id,
    className: `p-5 rounded-2xl border-2 text-left ${setup.mode === id ? 'border-sky-600 bg-sky-50' : 'border-slate-200'} disabled:opacity-40 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-sky-200`
  }, React.createElement("div", {
    className: "font-black"
  }, t), React.createElement("div", {
    className: "text-sm text-slate-500 mt-1"
  }, d)))), setup.mode !== 'wrong' && React.createElement("div", {
    className: "grid md:grid-cols-2 gap-5 mt-7"
  }, React.createElement("label", null, React.createElement("span", {
    className: "text-sm font-black"
  }, "Area"), React.createElement("select", {
    value: setup.area,
    onChange: e => setSetup({
      ...setup,
      area: e.target.value
    }),
    className: "mt-2 w-full p-3.5 border rounded-xl bg-white focus:ring-2 focus:ring-sky-300"
  }, React.createElement("option", null, "Semua"), areas.map(a => React.createElement("option", {
    key: a
  }, a)))), setup.mode === 'learn' && React.createElement("label", null, React.createElement("span", {
    className: "text-sm font-black"
  }, "Jumlah"), React.createElement("select", {
    value: setup.count,
    onChange: e => setSetup({
      ...setup,
      count: +e.target.value
    }),
    className: "mt-2 w-full p-3.5 border rounded-xl bg-white focus:ring-2 focus:ring-sky-300"
  }, [10, 20, 30, 50].map(n => React.createElement("option", {
    key: n,
    value: n
  }, n, " soal"))))), React.createElement("div", {
    className: "mt-5 flex gap-3 p-4 rounded-xl bg-sky-50 border border-sky-100"
  }, React.createElement("span", {
    "aria-hidden": "true"
  }, "\uD83D\uDD00"), React.createElement("span", null, React.createElement("span", {
    className: "font-bold text-sky-900"
  }, "Pilihan jawaban diacak otomatis"), React.createElement("span", {
    className: "block text-xs text-slate-600 mt-1"
  }, "Pengacakan dilakukan dan dikunci di server untuk menjaga integritas soal; urutannya tetap sama setelah refresh."))), message && React.createElement("div", {
    role: "status",
    "aria-live": "polite",
    className: "mt-5 p-4 rounded-xl bg-sky-50 text-sky-900 text-sm"
  }, message), React.createElement("button", {
    onClick: onStart,
    disabled: busy,
    className: "mt-7 w-full py-4 rounded-xl bg-sky-700 hover:bg-sky-800 text-white font-black disabled:opacity-50"
  }, busy ? 'Menyiapkan sesi…' : 'Mulai')));
}
function Exam({
  session,
  setSession,
  onFinish,
  favorites,
  setFavorites,
  busy,
  message
}) {
  const q = session.questions[session.current],
    answered = session.answers[session.current],
    flag = session.flagged.includes(session.current);
  const [timeLeft, setTimeLeft] = useState(() => session.mode === 'tryout' && session.expiresAt ? Math.max(0, Math.ceil((new Date(session.expiresAt).getTime() - Date.now()) / 1000)) : null);
  useEffect(() => {
    if (session.mode !== 'tryout' || !session.expiresAt) return;
    const tick = () => setTimeLeft(Math.max(0, Math.ceil((new Date(session.expiresAt).getTime() - Date.now()) / 1000)));
    tick();
    const id = setInterval(tick, 500);
    const vis = () => tick();
    document.addEventListener('visibilitychange', vis);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', vis);
    };
  }, [session.sessionId, session.expiresAt, session.mode]);
  useEffect(() => {
    if (session.mode === 'tryout' && timeLeft === 0 && !busy) onFinish();
  }, [timeLeft]);
  function answer(i) {
    setSession(p => ({
      ...p,
      answers: {
        ...p.answers,
        [p.current]: i
      }
    }));
  }
  function toggleFlag() {
    setSession(s => ({
      ...s,
      flagged: s.flagged.includes(s.current) ? s.flagged.filter(x => x !== s.current) : [...s.flagged, s.current]
    }));
  }
  function toggleFav() {
    setFavorites(x => x.includes(q.id) ? x.filter(id => id !== q.id) : [...x, q.id]);
  }
  function requestFinish() {
    const unanswered = session.questions.length - Object.keys(session.answers).length;
    const marked = session.flagged.length;
    const note = [unanswered ? `${unanswered} soal belum dijawab` : 'semua soal sudah dijawab', marked ? `${marked} soal ditandai ragu` : null].filter(Boolean).join(', ');
    if (confirm(`Akhiri sesi dan kirim jawaban? Ringkasan: ${note}.`)) onFinish();
  }
  const done = Object.keys(session.answers).length,
    progress = Math.round(done / session.questions.length * 100);
  return React.createElement("div", {
    className: "exam-shell h-screen bg-sky-50 flex flex-col lg:flex-row overflow-hidden"
  }, React.createElement("aside", {
    className: "exam-sidebar lg:w-80 bg-white border-r border-sky-100 flex flex-col lg:h-screen no-print"
  }, React.createElement("div", {
    className: "exam-brandbar p-5 bg-gradient-to-r from-sky-700 to-blue-800 text-white"
  }, React.createElement("div", {
    className: "flex items-center justify-between"
  }, React.createElement("div", null, React.createElement("div", {
    className: "font-black"
  }, "UKOM HEALTH PRO"), React.createElement("div", {
    className: "text-xs text-sky-100 mt-1"
  }, session.mode.toUpperCase(), " \xB7 ", done, "/", session.questions.length, " terjawab")), React.createElement("div", {
    className: "lg:hidden text-xs font-black bg-white/15 px-2.5 py-1.5 rounded-lg"
  }, progress, "%")), React.createElement("div", {
    className: "h-1.5 bg-white/20 rounded-full mt-3 overflow-hidden"
  }, React.createElement("div", {
    className: "h-full bg-white rounded-full transition-all",
    style: {
      width: progress + '%'
    }
  }))), React.createElement("div", {
    className: "exam-question-strip p-4 overflow-y-auto scrollbar flex-1"
  }, React.createElement("div", {
    className: "exam-question-grid grid grid-cols-8 lg:grid-cols-5 gap-2",
    "aria-label": "Navigasi nomor soal"
  }, session.questions.map((_, i) => {
    const a = session.answers[i] !== undefined,
      f = session.flagged.includes(i),
      active = i === session.current;
    return React.createElement("button", {
      key: i,
      onClick: () => setSession(s => ({
        ...s,
        current: i
      })),
      "aria-current": active ? 'step' : undefined,
      "aria-label": `Soal ${i + 1}${a ? ', sudah dijawab' : ''}${f ? ', ditandai ragu' : ''}`,
      className: `h-10 rounded-lg text-xs font-black border-2 relative shrink-0 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-sky-200 ${active ? 'ring-2 ring-sky-200 border-sky-600 bg-sky-50 text-sky-800' : a ? 'bg-emerald-600 border-emerald-600 text-white' : 'bg-white border-slate-200'}`
    }, i + 1, f && React.createElement("span", {
      "aria-hidden": "true",
      className: "absolute -top-1 -right-1 w-3 h-3 bg-amber-400 rounded-full"
    }));
  })))), React.createElement("main", {
    className: "flex-1 flex flex-col min-h-0 bg-sky-50"
  }, React.createElement("div", {
    className: "exam-main-header bg-white border-b border-sky-100 px-4 md:px-8 py-3 flex items-center justify-between no-print"
  }, React.createElement("div", {
    className: "min-w-0"
  }, React.createElement("div", {
    className: "font-black flex items-center"
  }, React.createElement("span", null, "Soal ", session.current + 1), React.createElement("span", {
    className: "exam-area ml-2 px-2 py-1 rounded-lg bg-sky-50 text-sky-800 text-xs"
  }, q.rumpun)), React.createElement("div", {
    className: "exam-id text-xs text-slate-400"
  }, "ID #", q.id, " \xB7 tersimpan otomatis di perangkat")), React.createElement("div", {
    className: "exam-actions flex gap-2 items-center shrink-0"
  }, session.mode === 'tryout' && React.createElement("div", {
    "aria-label": `Sisa waktu ${fmtTime(timeLeft || 0)}`,
    className: `exam-timer px-4 py-2 rounded-xl font-mono font-black ${(timeLeft || 0) <= 300 ? 'bg-rose-100 text-rose-700' : 'bg-sky-50 text-sky-800'}`
  }, fmtTime(timeLeft || 0)), React.createElement("button", {
    onClick: toggleFlag,
    "aria-pressed": flag,
    className: `px-3 py-2 rounded-xl font-bold focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-200 ${flag ? 'bg-amber-100 text-amber-800' : 'bg-slate-100'}`
  }, "\u2691 ", React.createElement("span", null, flag ? 'Ragu' : 'Tandai')), React.createElement("button", {
    onClick: requestFinish,
    disabled: busy,
    className: "px-4 py-2 rounded-xl bg-rose-600 text-white font-black disabled:opacity-50"
  }, busy ? 'Mengirim…' : 'Selesai'))), message && React.createElement("div", {
    role: "alert",
    "aria-live": "assertive",
    className: "mx-3 md:mx-8 mt-3 p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-sm"
  }, message, message.includes('belum tersimpan') && React.createElement("button", {
    onClick: onFinish,
    disabled: busy,
    className: "ml-3 underline font-black"
  }, "Coba Kirim Lagi")), React.createElement("div", {
    className: "exam-scroll flex-1 overflow-y-auto p-4 md:p-8 scrollbar"
  }, React.createElement("div", {
    className: "max-w-4xl mx-auto"
  }, React.createElement("div", {
    className: "exam-stem mobile-app-card bg-white border border-sky-100 rounded-3xl p-6 md:p-8 shadow-sm"
  }, React.createElement("p", {
    className: "text-lg md:text-xl font-semibold leading-relaxed"
  }, q.text)), React.createElement("div", {
    className: "space-y-3 mt-4 md:mt-5",
    role: "radiogroup",
    "aria-label": `Pilihan jawaban soal ${session.current + 1}`
  }, q.options.map((o, i) => React.createElement("button", {
    key: i,
    role: "radio",
    "aria-checked": answered === i,
    onClick: () => answer(i),
    className: `exam-option w-full text-left p-4 md:p-5 rounded-2xl border-2 flex gap-3 md:gap-4 transition active:scale-[.995] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-sky-200 ${answered === i ? 'border-sky-600 bg-sky-50 shadow-sm' : 'border-slate-200 bg-white hover:border-sky-300'}`
  }, React.createElement("span", {
    className: `letter w-9 h-9 rounded-xl grid place-items-center font-black shrink-0 ${answered === i ? 'bg-sky-700 text-white' : 'bg-slate-100 text-slate-700'}`
  }, LETTERS[i]), React.createElement("span", {
    className: "option-text font-semibold pt-1.5"
  }, o)))))), React.createElement("div", {
    className: "exam-bottom mobile-safe-bottom bg-white border-t border-sky-100 px-4 md:px-8 py-4 flex justify-between no-print"
  }, React.createElement("button", {
    onClick: () => setSession(s => ({
      ...s,
      current: Math.max(0, s.current - 1)
    })),
    disabled: session.current === 0 || busy,
    className: "px-5 py-3 rounded-xl bg-slate-100 font-bold disabled:opacity-40"
  }, "\u2190 Sebelumnya"), React.createElement("button", {
    onClick: toggleFav,
    className: "hidden md:block px-4 py-3 rounded-xl bg-sky-50 text-sky-800 font-bold"
  }, favorites.includes(q.id) ? '★ Tersimpan' : '☆ Simpan'), React.createElement("button", {
    onClick: () => setSession(s => ({
      ...s,
      current: Math.min(s.questions.length - 1, s.current + 1)
    })),
    disabled: session.current === session.questions.length - 1 || busy,
    className: "px-5 py-3 rounded-xl bg-sky-700 text-white font-black disabled:opacity-40"
  }, "Selanjutnya \u2192"))));
}
function Result({
  attempt,
  onDashboard,
  onWeak
}) {
  const r = readiness(attempt.score),
    rows = Object.entries(attempt.byArea || {}).map(([area, v]) => ({
      ...v,
      area,
      pct: v.total ? Math.round(100 * v.correct / v.total) : 0
    })).sort((a, b) => a.pct - b.pct),
    weak = rows[0]?.area;
  return React.createElement("main", {
    className: "max-w-6xl mx-auto px-4 md:px-8 py-10"
  }, React.createElement("div", {
    className: "rounded-[2rem] bg-gradient-to-br from-sky-700 to-blue-900 text-white p-8"
  }, React.createElement("div", {
    className: "text-sm text-sky-200 font-black"
  }, "HASIL ", programLabel(attempt.program)), React.createElement("div", {
    className: "text-7xl font-black mt-2"
  }, attempt.score, React.createElement("span", {
    className: "text-3xl"
  }, "%")), React.createElement("div", {
    className: "text-xl font-black mt-3"
  }, r.label), React.createElement("p", {
    className: "text-sm text-sky-100 mt-2 max-w-2xl"
  }, "Kategori ini adalah ringkasan performa latihan internal berdasarkan attempt ini, bukan ambang lulus UKOM dan bukan prediksi kelulusan tervalidasi."), React.createElement("div", {
    className: "grid grid-cols-3 gap-3 max-w-md mt-7"
  }, React.createElement(Mini, {
    label: "Benar",
    value: attempt.correct
  }), React.createElement(Mini, {
    label: "Salah",
    value: attempt.answered - attempt.correct
  }), React.createElement(Mini, {
    label: "Kosong",
    value: attempt.total - attempt.answered
  }))), React.createElement("div", {
    className: "grid lg:grid-cols-[.8fr,1.2fr] gap-6 mt-6"
  }, React.createElement("div", {
    className: "bg-white border rounded-3xl p-6"
  }, React.createElement("h2", {
    className: "text-xl font-black"
  }, "Analisis Area"), React.createElement("div", {
    className: "space-y-4 mt-5"
  }, rows.map(x => React.createElement("div", {
    key: x.area
  }, React.createElement("div", {
    className: "flex justify-between text-sm font-bold"
  }, React.createElement("span", null, x.area), React.createElement("span", null, x.pct, "%")), React.createElement("div", {
    className: "h-2.5 bg-slate-100 rounded-full mt-2"
  }, React.createElement("div", {
    className: `${x.pct >= 75 ? 'bg-emerald-600' : x.pct >= 60 ? 'bg-amber-500' : 'bg-rose-600'} h-full rounded-full`,
    style: {
      width: x.pct + '%'
    }
  }))))), weak && React.createElement("button", {
    onClick: () => onWeak(weak),
    className: "mt-6 w-full py-3 rounded-xl bg-sky-700 text-white font-black"
  }, "Latih 20 Soal ", weak)), React.createElement("div", {
    className: "bg-white border rounded-3xl p-6"
  }, React.createElement("h2", {
    className: "text-xl font-black"
  }, "Review & Rasional"), React.createElement("p", {
    className: "text-sm text-slate-500"
  }, "Kunci dan pembahasan tersedia setelah attempt tersimpan di server."), React.createElement("div", {
    className: "mt-5 max-h-[650px] overflow-y-auto scrollbar space-y-4"
  }, attempt.questions.map((q, i) => {
    const a = attempt.answers[i],
      ok = a === q.correctAnswer;
    return React.createElement("details", {
      key: q.id || i,
      className: "border rounded-2xl overflow-hidden"
    }, React.createElement("summary", {
      className: "p-4 cursor-pointer font-bold flex justify-between gap-3"
    }, React.createElement("span", null, "Soal ", i + 1, " \xB7 ", q.rumpun), React.createElement("span", {
      className: ok ? 'text-emerald-700' : 'text-rose-700'
    }, ok ? 'BENAR' : a === undefined ? 'KOSONG' : 'SALAH')), React.createElement("div", {
      className: "p-4 pt-0"
    }, React.createElement("p", {
      className: "font-semibold leading-7"
    }, q.text), React.createElement("div", {
      className: "text-sm mt-3"
    }, "Jawaban Anda: ", React.createElement("b", null, a === undefined ? '–' : LETTERS[a] + '. ' + q.options[a])), React.createElement("div", {
      className: "text-sm"
    }, "Kunci: ", React.createElement("b", null, LETTERS[q.correctAnswer], ". ", q.options[q.correctAnswer])), React.createElement("div", {
      className: "mt-4 p-4 rounded-xl bg-sky-50 text-sm leading-6 whitespace-pre-line"
    }, q.explanation), q.reference && React.createElement("div", {
      className: "mt-3 text-xs text-slate-500 break-words"
    }, React.createElement("b", null, "Sumber:"), " ", q.reference)));
  })))), React.createElement("button", {
    onClick: onDashboard,
    className: "mt-8 px-6 py-3 rounded-xl bg-slate-900 text-white font-black no-print"
  }, "Kembali ke Dashboard"));
}
function Mini({
  label,
  value
}) {
  return React.createElement("div", {
    className: "rounded-2xl bg-white/10 p-4 text-center"
  }, React.createElement("div", {
    className: "text-3xl font-black"
  }, value), React.createElement("div", {
    className: "text-xs text-slate-300"
  }, label));
}
function History({
  attempts,
  onBack,
  onOpen,
  busy
}) {
  return React.createElement("main", {
    className: "max-w-5xl mx-auto px-4 py-10"
  }, React.createElement("button", {
    onClick: onBack,
    className: "font-bold text-slate-500"
  }, "\u2190 Dashboard"), React.createElement("h1", {
    className: "text-3xl font-black mt-5"
  }, "Riwayat Perkembangan"), React.createElement("p", {
    className: "text-slate-500 mt-2"
  }, "Pembahasan attempt tersimpan dapat dibuka kembali dengan verifikasi kepemilikan di server."), React.createElement("div", {
    className: "space-y-3 mt-6"
  }, attempts.length ? attempts.map(a => React.createElement("div", {
    key: a.id,
    className: "bg-white border rounded-2xl p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
  }, React.createElement("div", null, React.createElement("div", {
    className: "font-black"
  }, a.mode === 'trial' ? 'Trial Gratis' : a.mode === 'tryout' ? 'Simulasi 180' : 'Latihan'), React.createElement("div", {
    className: "text-xs text-slate-400"
  }, new Date(a.createdAt).toLocaleString('id-ID'), " \xB7 ", a.correct, "/", a.total, " benar")), React.createElement("div", {
    className: "flex items-center gap-3"
  }, React.createElement("div", {
    className: "text-3xl font-black"
  }, a.score, "%"), React.createElement("button", {
    onClick: () => onOpen(a.id),
    disabled: busy,
    className: "px-4 py-2.5 rounded-xl bg-sky-700 text-white font-black disabled:opacity-50"
  }, "Lihat Pembahasan")))) : React.createElement("div", {
    className: "bg-white border rounded-2xl p-8 text-slate-500 text-center"
  }, "Belum ada riwayat.")));
}
function Profile({
  profile,
  onSave,
  onBack
}) {
  const [f, setF] = useState({
      ...profile
    }),
    [busy, setBusy] = useState(false),
    [err, setErr] = useState('');
  async function submit() {
    setBusy(true);
    try {
      await onSave(f);
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }
  return React.createElement("main", {
    className: "max-w-2xl mx-auto px-4 py-10"
  }, React.createElement("button", {
    onClick: onBack,
    className: "font-bold text-slate-500"
  }, "\u2190 Dashboard"), React.createElement("div", {
    className: "bg-white border rounded-3xl p-7 mt-5"
  }, React.createElement("h1", {
    className: "text-2xl font-black"
  }, "Profil Mahasiswa"), React.createElement("div", {
    className: "space-y-5 mt-6"
  }, React.createElement(Field, {
    label: "Nama lengkap",
    value: f.full_name,
    onChange: v => setF({
      ...f,
      full_name: v
    })
  }), React.createElement(Field, {
    label: "Institusi",
    value: f.institution,
    onChange: v => setF({
      ...f,
      institution: v
    })
  }), React.createElement("label", {
    className: "block"
  }, React.createElement("span", {
    className: "text-sm font-black"
  }, "Program"), React.createElement("select", {
    value: f.program,
    onChange: e => setF({
      ...f,
      program: e.target.value
    }),
    className: "mt-2 w-full p-3.5 border rounded-xl bg-white"
  }, React.createElement("option", {
    value: "ners"
  }, "Profesi Ners"), React.createElement("option", {
    value: "d3"
  }, "D3 Keperawatan"), React.createElement("option", {
    value: "bidan"
  }, "Profesi Bidan")), React.createElement("div", {
    className: "text-xs text-amber-600 mt-2"
  }, "Akses premium berlaku per program. Mengganti program akan mengubah bank soal dashboard.")), React.createElement(Field, {
    label: "Target UKOM",
    value: f.target_ukom || '',
    onChange: v => setF({
      ...f,
      target_ukom: v
    })
  })), err && React.createElement("div", {
    className: "mt-4 text-rose-600 text-sm"
  }, err), React.createElement("button", {
    onClick: submit,
    disabled: busy,
    className: "mt-7 w-full py-3.5 rounded-xl bg-slate-900 text-white font-black"
  }, busy ? 'Menyimpan…' : 'Simpan Perubahan')));
}
function Help({
  onBack
}) {
  const faqs = [['Bagaimana memulai latihan?', 'Dari Dashboard pilih Trial 20 soal jika masih tersedia. Setelah Premium aktif, pilih Mulai Latihan / Tryout dan tentukan mode serta area.'], ['Apakah jawaban bisa diubah?', 'Bisa. Selama sesi belum diselesaikan, Anda dapat berpindah soal dan mengganti pilihan jawaban.'], ['Apa fungsi Tandai/Ragu?', 'Gunakan Tandai untuk soal yang ingin diperiksa lagi sebelum submit. Titik kuning pada nomor soal menunjukkan soal yang ditandai.'], ['Mengapa kunci tidak muncul saat mengerjakan?', 'Kunci dan pembahasan disimpan di server dan baru diberikan setelah attempt selesai agar latihan tidak membocorkan jawaban.'], ['Bagaimana Premium aktif setelah membayar?', 'Setelah pembayaran Midtrans selesai, kembali ke aplikasi lalu tekan Cek Status Akses. Bila settlement sudah diterima, Premium aktif otomatis.'], ['Apakah progres tersimpan?', 'Attempt yang sudah disubmit tersimpan pada akun dan dapat dilihat di Riwayat. Sesi aktif juga disimpan secara lokal pada perangkat selama belum disubmit.']];
  return React.createElement("main", {
    className: "max-w-5xl mx-auto px-4 md:px-8 py-8 md:py-10"
  }, React.createElement("button", {
    onClick: onBack,
    className: "font-bold text-sky-700"
  }, "\u2190 Kembali ke Dashboard"), React.createElement("div", {
    className: "mt-5 rounded-[2rem] bg-gradient-to-br from-sky-500 to-blue-700 text-white p-7 md:p-10"
  }, React.createElement("div", {
    className: "text-xs font-black text-sky-100"
  }, "PANDUAN PENGGUNA"), React.createElement("h1", {
    className: "text-3xl md:text-5xl font-black mt-2"
  }, "Cara menggunakan UKOM Health Pro"), React.createElement("p", {
    className: "text-sky-50 mt-3 max-w-2xl leading-7"
  }, "Gunakan alur sederhana ini: pilih program \u2192 mulai trial/latihan \u2192 kerjakan dan tandai soal ragu \u2192 submit \u2192 pelajari analitik dan pembahasan.")), React.createElement("div", {
    className: "grid sm:grid-cols-2 lg:grid-cols-4 gap-4 mt-6"
  }, [['1', 'Pilih mode', 'Trial, latihan per area, remediasi soal salah, atau Simulasi 180 soal.'], ['2', 'Kerjakan', 'Baca vignette, pilih A–E, gunakan Tandai bila ingin kembali.'], ['3', 'Submit', 'Tekan Selesai setelah yakin. Skor dihitung secara server-side.'], ['4', 'Evaluasi', 'Pelajari skor, area lemah, dan pembahasan sebelum latihan berikutnya.']].map(([n, t, d]) => React.createElement("div", {
    key: n,
    className: "mobile-app-card bg-white border border-sky-100 rounded-3xl p-5 shadow-sm"
  }, React.createElement("div", {
    className: "w-9 h-9 bg-sky-100 text-sky-700 rounded-xl grid place-items-center font-black"
  }, n), React.createElement("div", {
    className: "font-black mt-4"
  }, t), React.createElement("div", {
    className: "text-sm text-slate-500 leading-6 mt-2"
  }, d)))), React.createElement("h2", {
    className: "text-2xl font-black mt-9"
  }, "FAQ"), React.createElement("div", {
    className: "space-y-3 mt-4"
  }, faqs.map(([q, a], i) => React.createElement("details", {
    key: i,
    className: "rounded-2xl border border-sky-100 bg-white p-5 shadow-sm"
  }, React.createElement("summary", {
    className: "cursor-pointer font-black"
  }, q), React.createElement("p", {
    className: "text-slate-600 leading-7 mt-3"
  }, a)))));
}
function Pricing({
  onClose,
  onCheckout,
  onRefresh,
  program,
  message,
  busy
}) {
  const modalRef = useRef(null);
  useEffect(() => {
    const el = modalRef.current;
    const first = el?.querySelector('button');
    first?.focus();
    const key = e => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'Tab' && el) {
        const fs = [...el.querySelectorAll('button,a,[tabindex]:not([tabindex="-1"])')].filter(x => !x.disabled);
        if (!fs.length) return;
        const i = fs.indexOf(document.activeElement);
        if (e.shiftKey && i <= 0) {
          e.preventDefault();
          fs[fs.length - 1].focus();
        } else if (!e.shiftKey && i === fs.length - 1) {
          e.preventDefault();
          fs[0].focus();
        }
      }
    };
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  }, []);
  return React.createElement("div", {
    className: "fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-sm grid place-items-center p-4"
  }, React.createElement("div", {
    ref: modalRef,
    role: "dialog",
    "aria-modal": "true",
    "aria-labelledby": "pricing-title",
    className: "w-full max-w-lg bg-white rounded-[2rem] p-7 md:p-9 relative shadow-2xl"
  }, React.createElement("button", {
    onClick: onClose,
    "aria-label": "Tutup dialog pembayaran",
    className: "absolute right-5 top-5 w-10 h-10 rounded-full bg-slate-100 font-black"
  }, "\xD7"), React.createElement("div", {
    className: "text-xs font-black text-sky-700"
  }, "PROMO LAUNCHING"), React.createElement("h2", {
    id: "pricing-title",
    className: "text-3xl font-black mt-2"
  }, "Aktifkan ", programLabel(program)), React.createElement("p", {
    className: "text-slate-500 mt-2"
  }, "Akses premium 30 hari: simulasi 180 soal, latihan per area, remediasi, pembahasan lengkap, dan analitik."), React.createElement("div", {
    className: "mt-6 p-5 rounded-2xl bg-slate-950 text-white text-center"
  }, React.createElement("div", {
    className: "line-through text-slate-400"
  }, money(APP_CONFIG.NORMAL_PRICE)), React.createElement("div", {
    className: "text-5xl font-black"
  }, money(APP_CONFIG.PROMO_PRICE))), React.createElement("div", {
    className: "mt-5 p-3 rounded-xl bg-sky-50 text-center text-sm font-bold text-slate-700"
  }, "Metode pembayaran ditampilkan langsung oleh Midtrans sesuai metode yang aktif pada merchant."), React.createElement("button", {
    onClick: onCheckout,
    disabled: busy,
    className: "mt-5 w-full py-4 rounded-xl bg-sky-700 hover:bg-sky-800 text-white font-black disabled:opacity-50"
  }, busy ? 'Menyiapkan pembayaran…' : 'Bayar & Aktifkan'), React.createElement("button", {
    onClick: onRefresh,
    disabled: busy,
    className: "mt-3 w-full py-3 rounded-xl bg-slate-100 font-bold"
  }, "Saya Sudah Bayar \u2014 Cek Status"), message && React.createElement("div", {
    role: "status",
    "aria-live": "polite",
    className: "mt-4 p-3 rounded-xl bg-slate-50 text-xs text-slate-600"
  }, message), React.createElement("p", {
    className: "text-[11px] text-slate-400 mt-4"
  }, "Pembayaran diproses melalui Midtrans. Akses Premium aktif otomatis setelah pembayaran terverifikasi.")));
}
ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(App, null));