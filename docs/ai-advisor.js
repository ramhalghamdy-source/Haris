/* HARIS AI Advisor
   Explainable decision-support built on top of the client-side Isolation Forest output.
   The displayed priority index is a transparent heuristic, not a calibrated probability. */
(function(){
'use strict';

function clamp(v,min,max){return Math.max(min,Math.min(max,v))}

function deviationProfile(b,r){
  const c=BRANCHES[b];
  const day=new Date().getHours()>=8&&new Date().getHours()<20;
  const means={voltage:220,current:day?c.dayI:c.nightI,temperature:day?c.dayT:c.nightT};
  const stds={voltage:3,current:c.iStd,temperature:c.tStd};
  const z={
    voltage:(r.voltage-means.voltage)/stds.voltage,
    current:(r.current-means.current)/stds.current,
    temperature:(r.temperature-means.temperature)/stds.temperature
  };
  const abs=Object.fromEntries(Object.entries(z).map(([k,v])=>[k,Math.abs(v)]));
  const dominant=Object.keys(abs).sort((a,b)=>abs[b]-abs[a])[0];
  return{means,stds,z,abs,dominant,maxZ:abs[dominant]};
}

function trendSignal(b,fault){
  const arr=history[b]||[];
  if(arr.length<8||fault==='none')return{state:'stable',label:'الاتجاه غير كافٍ للحكم بعد'};
  const recent=arr.slice(-4),prior=arr.slice(-8,-4);
  const avg=(a,key)=>a.reduce((n,x)=>n+x[key],0)/a.length;
  let key='temperature',sign=1;
  if(fault==='overload'){key='current';sign=1}
  else if(fault==='voltage_drop'){key='voltage';sign=-1}
  else if(fault==='voltage_spike'){key='voltage';sign=1}
  else if(fault==='overheat'){key='temperature';sign=1}
  const d=(avg(recent,key)-avg(prior,key))*sign;
  const threshold=key==='voltage'?1.2:key==='current'?.25:.7;
  if(d>threshold)return{state:'worse',label:'الاتجاه يتفاقم في القراءات الأخيرة'};
  if(d<-threshold)return{state:'better',label:'الاتجاه يتحسن في القراءات الأخيرة'};
  return{state:'stable',label:'الاتجاه مستقر حاليًا'};
}

function makePlan(r){
  const p=deviationProfile(r.branch,r);
  const trend=trendSignal(r.branch,r.fault_type);
  let score,priority,headline,steps,escalate;

  if(r.status==='normal'){
    score=clamp(Math.round(12+p.maxZ*4),8,34);
    priority='مراقبة';
    headline='استمري بالمراقبة؛ لا توجد إشارة تستدعي إجراءً فوريًا.';
    steps=[
      'تابعي القراءات الحية واتجاه الجهد والتيار والحرارة.',
      'لا تغيّري تشغيل الخط بناءً على قراءة طبيعية منفردة.',
      'إذا ظهر تحذير متكرر، راجعي سجل الأحداث وقارني النمط قبل التصعيد.'
    ];
    escalate='صعّدي للفحص إذا تحولت الحالة إلى خطر، أو تكرر التحذير عدة قراءات متتالية، أو ظهرت رائحة/دخان/سخونة فعلية في الموقع.';
  }else{
    score=(r.status==='danger'?80:55)+Math.min(14,Math.round(p.maxZ*2))+(trend.state==='worse'?5:0)-(trend.state==='better'?3:0);
    score=clamp(score,40,98);
    priority=r.status==='danger'?(trend.state==='worse'?'فوري':'عالي'):(trend.state==='worse'?'عالي':'متوسط');
    const danger=r.status==='danger';
    const plans={
      overload:{
        headline:danger?'خفّضي الحمل فورًا، وإذا استمرت حالة الخطر فأوقفي استخدام الخط واطلبي فحصًا متخصصًا.':'خفّضي الأحمال غير الضرورية وراقبي هل يعود التيار والحرارة للنطاق الطبيعي.',
        steps:[
          'افصلي الأحمال غير الضرورية من مفاتيح أو مقابس الاستخدام العادية فقط.',
          'راقبي التيار والحرارة خلال القراءات التالية وتحققي أن الاتجاه يتحسن.',
          'إذا بقي الخطر أو ارتفعت الحرارة، أوقفي استخدام الخط واطلبي كهربائيًا مؤهلًا لفحص القاطع وتوزيع الحمل.'
        ],
        escalate:'تصعيد فوري إذا استمرت حالة الخطر، أو ارتفعت الحرارة بوضوح، أو ظهرت رائحة احتراق/دخان/شرر.'
      },
      voltage_drop:{
        headline:danger?'احمي الأجهزة الحساسة من الاستمرار على الخط واطلبي فحص مصدر الهبوط والتوصيلات.':'راقبي الجهد وقللي تشغيل الأجهزة الحساسة إلى أن يتضح إن كان الهبوط عابرًا أم مستمرًا.',
        steps:[
          'أوقفي أو افصلي الأجهزة الحساسة من نقاط الاستخدام العادية إذا كان ذلك آمنًا.',
          'قارني الجهد خلال عدة قراءات وتحققي هل يعود سريعًا إلى المستوى الطبيعي.',
          'إذا استمر الهبوط، اطلبي فحص التوصيلات ونقاط الربط بعد فصل التغذية بواسطة كهربائي مؤهل.'
        ],
        escalate:'تصعيد عاجل إذا بقي الجهد منخفضًا، تكرر الحدث، سخنت نقطة توصيل، أو تأثرت عدة خطوط في الوقت نفسه.'
      },
      voltage_spike:{
        headline:danger?'احمي الأجهزة الحساسة وأوقفي استخدامها على الخط حتى يتم التحقق من مصدر ارتفاع الجهد.':'راقبي تكرار الارتفاع واحمي الأجهزة الحساسة إذا ظهرت قفزات إضافية.',
        steps:[
          'أوقفي استخدام الأجهزة الحساسة على الخط إذا كان ذلك ممكنًا من نقاط الاستخدام العادية.',
          'راقبي هل الارتفاع لحظي أم متكرر في سجل الأحداث.',
          'عند التكرار، اطلبي فحص مصدر التغذية والتأريض ووسائل الحماية من زيادة الجهد بواسطة كهربائي مؤهل.'
        ],
        escalate:'تصعيد عاجل إذا تكرر الارتفاع، وصلت الحالة إلى خطر، أو ظهرت أعطال متزامنة في أجهزة متعددة.'
      },
      overheat:{
        headline:danger?'أوقفي استخدام الخط الآن؛ الحرارة المرتفعة تستحق فحصًا قبل إعادة التشغيل.':'خفّضي استخدام الخط وراقبي الحرارة عن قرب؛ أي تصاعد إضافي يحتاج إيقافًا وفحصًا.',
        steps:[
          'أوقفي تشغيل الأحمال على الخط من مفاتيح الاستخدام العادية.',
          'لا تفتحي اللوحة ولا تلمسي مكونات ساخنة أو موصلة بالكهرباء.',
          'إذا استمرت الحرارة أو بقيت حالة الخطر، افصلي التغذية فقط إذا كان ذلك آمنًا ومسموحًا، ثم استدعي كهربائيًا مؤهلًا.'
        ],
        escalate:'تصعيد فوري عند استمرار ارتفاع الحرارة، أو وجود رائحة احتراق/دخان/شرر، أو سخونة واضحة في اللوحة أو القاطع.'
      }
    };
    const q=plans[r.fault_type]||plans.overload;
    headline=q.headline;steps=q.steps;escalate=q.escalate;
  }

  const keyAr={voltage:'الجهد',current:'التيار',temperature:'الحرارة'}[p.dominant];
  const direction=p.z[p.dominant]>=0?'أعلى':'أقل';
  const why=r.status==='normal'
    ?`أكبر انحراف حالي هو ${keyAr} بمقدار ${p.maxZ.toFixed(1)}σ تقريبًا، لكنه لم يدفع النموذج إلى مستوى التحذير.`
    :`النموذج صنّف القراءة ${statusAr[r.status]}، وأقوى انحراف هو ${keyAr} (${direction} من النمط المعتاد بنحو ${p.maxZ.toFixed(1)}σ). ${trend.label}.`;

  return{score,priority,headline,steps,escalate,why,trend};
}

function answer(kind,r,plan){
  if(kind==='now')return `<b>الإجراء الآن:</b> ${plan.headline}<br>${plan.steps.map((x,i)=>`${i+1}) ${x}`).join('<br>')}`;
  if(kind==='why')return `<b>لماذا؟</b> ${plan.why}<br><span style="color:var(--faint)">Anomaly score = ${r.anomaly_score}</span>`;
  if(kind==='escalate')return `<b>متى أصعّد؟</b> ${plan.escalate}`;
  return `<b>ملخص HARIS AI:</b> الأولوية ${plan.priority} ومؤشر القرار ${plan.score}/100. ${plan.headline}`;
}

function renderAdvisor(){
  const el=document.getElementById('aiAdvisor');
  if(!el||typeof latest==='undefined'||typeof selected==='undefined')return;
  const r=latest[selected];
  if(!r){el.innerHTML='<div class="empty">يتم تجهيز مستشار حارس الذكي…</div>';return}
  const plan=makePlan(r);
  const trendClass=plan.trend.state;
  el.innerHTML=`
    <div class="ai-head">
      <div class="ai-brand"><div class="ai-icon">✦</div><div class="ai-name">مستشار حارس الذكي<small>HARIS AI Advisor · Explainable decision support</small></div></div>
      <span class="ai-tag">AI DECISION SUPPORT</span>
    </div>
    <div class="ai-summary">
      <div class="priority-card ${r.status}">
        <div><div class="k">مؤشر أولوية القرار</div><div class="score-ring">${plan.score}</div></div>
        <div><div class="priority-label">${plan.priority}</div><div class="priority-sub">ليس احتمالًا إحصائيًا؛ مؤشر قرار تفسيري</div></div>
      </div>
      <div class="ai-main">
        <div class="k">RECOMMENDED NEXT ACTION</div>
        <div class="headline">${plan.headline}</div>
        <div class="why">${plan.why}</div>
        <span class="trend-chip ${trendClass}">${trendClass==='worse'?'↑':trendClass==='better'?'↓':'→'} ${plan.trend.label}</span>
      </div>
    </div>
    <div class="ai-grid">
      <div class="ai-steps"><div class="k">خطة الإجراء المقترحة</div>${plan.steps.map((x,i)=>`<div class="step"><span class="step-num">${i+1}</span><span>${x}</span></div>`).join('')}</div>
      <div class="ai-escalate"><div class="k">شرط التصعيد</div><div class="v">${plan.escalate}</div><div class="ai-safety">⚠️ توصيات حارس دعم قرار للنموذج الأولي. لا تفتحي لوحة كهربائية أو تلمسي مكونات مكهربة؛ أي فحص داخلي أو أعمال على القاطع والتوصيلات يجب أن ينفذها شخص مؤهل وبعد عزل الطاقة بطريقة مناسبة.</div></div>
    </div>
    <div class="ai-ask">
      <div class="ai-ask-title">اسألي حارس عن الحالة الحالية</div>
      <div class="ai-quick"><button class="ai-q" data-ai="now">ماذا أفعل الآن؟</button><button class="ai-q" data-ai="why">لماذا أعطاني هذا التنبيه؟</button><button class="ai-q" data-ai="escalate">متى أحتاج فنيًا؟</button><button class="ai-q" data-ai="summary">لخّص القرار</button></div>
      <div class="ai-answer" id="aiAnswer"></div>
    </div>`;
  el.querySelectorAll('.ai-q').forEach(btn=>btn.onclick=()=>{
    const box=document.getElementById('aiAnswer');
    box.innerHTML=answer(btn.dataset.ai,r,plan);
    box.classList.add('show');
  });
}

setTimeout(renderAdvisor,160);
setInterval(renderAdvisor,500);
})();
