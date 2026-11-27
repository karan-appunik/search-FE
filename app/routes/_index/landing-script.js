// Askmerce landing page behaviour: theme switch, hero typing,
// "normal search vs Askmerce" demo and the merchant walkthrough.
// Runs in the browser only (called from useEffect); returns a
// stop function that ends every loop, timer and observer.

export function startLanding() {
  var alive = true;
  var stops = [];

  (function(){
    var root = document.documentElement, themeBtn = document.getElementById("themeBtn");
    function syncThemeLabel(){ themeBtn.setAttribute("aria-label", root.getAttribute("data-theme") === "dark" ? "Switch to light mode" : "Switch to dark mode"); }
    syncThemeLabel();
    themeBtn.addEventListener("click", function(){
      var next = root.getAttribute("data-theme") === "dark" ? "light" : "dark";
      root.setAttribute("data-theme", next);
      try{ localStorage.setItem("askmerce-theme", next); }catch(e){ /* storage blocked: theme still switches */ }
      syncThemeLabel();
    });
  })();
  (function(){
    var reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    var tint = {
      sky:["var(--sky-soft)","var(--sky)"], violet:["var(--violet-soft)","var(--violet)"],
      mint:["var(--mint-soft)","var(--mint)"], amber:["var(--amber-soft)","var(--amber)"],
      coral:["var(--coral-soft)","var(--coral)"], lime:["var(--lime-soft)","var(--lime-deep)"],
      grey:["#eef0f3","#94a3b8"]
    };
    function thumb(icon,c){
      var t = tint[c]||tint.grey;
      return '<span class="thumb" style="background:'+t[0]+';color:'+t[1]+'"><svg width="28" height="28"><use href="#i-'+icon+'"/></svg></span>';
    }
    function wait(ms){ return new Promise(function(r){ setTimeout(r, reduce ? 0 : ms); }); }

    /* ---------- reveal on scroll ---------- */
    var io = new IntersectionObserver(function(es){
      es.forEach(function(e){ if(e.isIntersecting){ e.target.classList.add("in"); io.unobserve(e.target); } });
    },{threshold:.12});
    document.querySelectorAll(".reveal").forEach(function(el){ io.observe(el); });
    stops.push(function(){ io.disconnect(); });

    /* ---------- HERO typing loop ---------- */
    var heroData = [
      {q:"warm jacket for snowy hikes", why:"Matched warmth, outdoor use and weather", items:[["Insulated hiking anorak","$139","jacket","sky"],["Waterproof down jacket","$129","jacket","violet"],["Fleece-lined shell","$98","jacket","mint"]]},
      {q:"gift for dad who loves coffee", why:"Matched the person, the occasion and the interest", items:[["Pour-over coffee set","$42","cup","amber"],["Stoneware mug duo","$28","cup","coral"],["Gift card bundle","$50","gift","violet"]]},
      {q:"couch for a small living room", why:"Matched couch → sofas, and a small space", items:[["Compact loveseat","$649","sofa","sky"],["2-seat linen sofa","$720","sofa","violet"],["Armless sofa","$560","sofa","mint"]]}
    ];
    var hq = document.getElementById("heroQ"), hr = document.getElementById("heroResults"), hw = document.getElementById("heroWhy");
    async function heroLoop(){
      await wait(1700);
      var i = 0;
      while(alive){
        var d = heroData[i % heroData.length];
        hr.innerHTML = d.items.map(function(it){ return '<div class="hcard">'+thumb(it[2],it[3])+'<div><b>'+it[0]+'</b><span>'+it[1]+'</span></div></div>'; }).join("");
        hw.style.opacity = 0;
        for(var k=1;k<=d.q.length;k++){ hq.textContent = d.q.slice(0,k); await wait(55 + Math.random()*60); }
        await wait(350);
        hw.innerHTML = '<svg class="spark" style="color:var(--lime-deep)"><use href="#i-spark"/></svg>'+d.why;
        hw.style.opacity = 1;
        var cards = hr.querySelectorAll(".hcard");
        for(var c=0;c<cards.length;c++){ cards[c].classList.add("show"); await wait(140); }
        await wait(2600);
        for(var c2=0;c2<cards.length;c2++) cards[c2].classList.remove("show");
        for(var b=d.q.length;b>=0;b--){ hq.textContent = d.q.slice(0,b); await wait(22); }
        i++;
      }
    }
    heroLoop();

    /* ---------- COMPARISON ---------- */
    var QUESTIONS = ["What's best for cold weather?", "Gifts under $50", "What's new this week?"];
    var examples = [
      { q:"couch", normal:{empty:true},
        ai:{why:"Same meaning → <b>sofas</b>", items:[["3-seat linen sofa","$899","sofa","violet"],["Compact loveseat","$649","sofa","sky"],["Corner sofa","$1,190","sofa","mint"]]},
        bad:"0 results — even though you sell sofas" },
      { q:"warm jacket for winter hikes", normal:{wrong:[["Light denim jacket","$59","jacket"],["Summer windbreaker","$45","jacket"]]},
        ai:{why:"Matched <b>warm</b> + <b>outdoor</b> + <b>winter</b>", items:[["Insulated hiking anorak","$139","jacket","sky"],["Waterproof down jacket","$129","jacket","violet"],["Fleece-lined shell","$98","jacket","mint"]]},
        bad:"Wrong products — only “jacket” matched" },
      { q:"gift for dad under $50", normal:{empty:true},
        ai:{why:"Matched <b>gift</b> + <b>for dad</b> + <b>under $50</b>", items:[["Pour-over coffee set","$42","cup","amber"],["Stoneware mug duo","$28","cup","coral"],["Leather wallet gift box","$45","gift","violet"]]},
        bad:"0 results — budgets aren't understood" },
      { q:"What's best for cold weather?", question:0, normal:{empty:true},
        ai:{why:"Your search question → <b>warm picks</b>", items:[["Insulated hiking anorak","$139","jacket","sky"],["Waterproof down jacket","$129","jacket","violet"],["Fleece-lined shell","$98","jacket","mint"]]},
        bad:"Had to type it all — and got 0 results" }
    ];
    var pN = document.getElementById("pN"), pA = document.getElementById("pA");
    var oN = document.getElementById("oN"), oA = document.getElementById("oA");
    var hand = document.getElementById("hand");
    var chips = document.querySelectorAll(".chip");
    var shopper = document.getElementById("shopper"), avUse = document.getElementById("avUse"), shopLine = document.getElementById("shopLine");
    var run = 0;
    var ARROW = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>';

    function el(p,s){ return p.querySelector(s); }
    function setFace(face, text){
      avUse.setAttribute("href", "#i-" + face);
      shopLine.textContent = text;
      shopper.classList.remove("joy");
      if(face === "happy"){ void shopper.offsetWidth; shopper.classList.add("joy"); }
    }
    function faceIcon(face){ return '<svg width="24" height="24" aria-hidden="true"><use href="#i-'+face+'"/></svg>'; }
    function moveHand(target){
      var pr = pA.getBoundingClientRect(), tr = target.getBoundingClientRect();
      hand.style.opacity = 1;
      hand.style.transform = "translate("+(tr.left - pr.left + tr.width*0.5)+"px,"+(tr.top - pr.top + tr.height*0.35)+"px)";
    }
    function tapFx(p){ var t = el(p,".tap"); t.classList.remove("go"); void t.offsetWidth; t.classList.add("go"); }
    function showQuestions(show){
      el(pA,".qs").innerHTML = show ? '<p class="ps-h">Popular questions</p><div class="qchips2">' + QUESTIONS.map(function(q,i){ return '<span data-q="'+i+'">'+q+'</span>'; }).join("") + '</div>' : "";
    }
    function productsHtml(items, wrong){
      return '<p class="ps-h">Products</p>' + items.map(function(it){
        return '<div class="ps-item'+(wrong?' wrong':'')+'">'+thumb(it[2], wrong ? "grey" : it[3])+'<span class="pinfo"><b>'+it[0]+'</b><span>'+it[1]+'</span>'+(wrong?'<em class="miss">Not what they meant</em>':'')+'</span></div>';
      }).join("");
    }
    function footHtml(q){ return '<div class="ps-foot"><span>Search for “'+q+'”</span>'+ARROW+'</div>'; }
    function revealItems(p){ p.querySelectorAll(".ps-item").forEach(function(c,i){ setTimeout(function(){ c.classList.add("show"); }, 60+i*140); }); }
    function renderAI(ex){
      el(pA,".results").innerHTML = '<div class="status"><svg class="spark" style="color:var(--lime-deep)"><use href="#i-spark"/></svg><span>'+ex.ai.why+'</span></div>' + productsHtml(ex.ai.items) + footHtml(ex.q);
      revealItems(pA);
    }
    function renderNormal(ex){
      var rn = el(pN,".results");
      if(ex.normal.empty){
        rn.innerHTML = '<p class="ps-empty">No results found for “'+ex.q+'”. Check the spelling or use a different word or phrase.</p>' + footHtml(ex.q);
      } else {
        rn.innerHTML = productsHtml(ex.normal.wrong, true) + footHtml(ex.q);
        revealItems(pN);
      }
    }
    function skeleton(p){ el(p,".results").innerHTML = '<div class="skel"></div><div class="skel"></div>'; }

    async function play(idx){
      if(!alive) return;
      var id = ++run, ex = examples[idx];
      chips.forEach(function(c){ c.setAttribute("aria-pressed", String(+c.dataset.i === idx)); });
      [pN,pA].forEach(function(p){ el(p,".q").textContent=""; el(p,".results").innerHTML=""; el(p,".sinput").classList.remove("active"); el(p,".cbadge").classList.remove("on"); });
      showQuestions(false);
      oN.classList.remove("show"); oA.classList.remove("show");
      hand.style.opacity = 0; hand.style.transform = "translate(240px,520px)";
      setFace("think", "Looking for something on their phone…");
      await wait(500); if(id!==run) return;

      // shopper opens search in both stores
      moveHand(el(pA,".sinput"));
      await wait(950); if(id!==run) return;
      tapFx(pN); tapFx(pA);
      el(pN,".sinput").classList.add("active"); el(pA,".sinput").classList.add("active");
      hand.style.opacity = 0;
      showQuestions(true); // only the Askmerce store shows its search questions
      await wait(1000); if(id!==run) return;

      if(ex.question != null){
        // Askmerce: one tap on a question
        setFace("think", "Sees a question that fits…");
        var chip = el(pA,'.qchips2 span[data-q="'+ex.question+'"]');
        moveHand(chip);
        await wait(950); if(id!==run) return;
        chip.classList.add("hit"); hand.style.opacity = 0;
        await wait(300); if(id!==run) return;
        el(pA,".q").textContent = ex.q;
        showQuestions(false);
        skeleton(pA);
        await wait(500); if(id!==run) return;
        renderAI(ex);
        // normal store: no questions, so the shopper types it all
        setFace("think", "Normal store: has to type it all…");
        for(var t=1;t<=ex.q.length;t++){ if(id!==run) return; el(pN,".q").textContent = ex.q.slice(0,t); await wait(60+Math.random()*60); }
        skeleton(pN);
        await wait(600); if(id!==run) return;
        renderNormal(ex);
      } else {
        setFace("think", "Typing: “" + ex.q + "”");
        showQuestions(false);
        for(var k=1;k<=ex.q.length;k++){
          if(id!==run) return;
          el(pN,".q").textContent = el(pA,".q").textContent = ex.q.slice(0,k);
          await wait(70 + Math.random()*70);
        }
        await wait(300); if(id!==run) return;
        skeleton(pN); skeleton(pA);
        await wait(700); if(id!==run) return;
        renderNormal(ex);
        renderAI(ex);
      }
      await wait(500); if(id!==run) return;
      oN.innerHTML = faceIcon("sad") + ex.bad; oN.classList.add("show");

      // shopper picks the first Askmerce result -> cart
      await wait(500); if(id!==run) return;
      var first = el(pA,".ps-item");
      moveHand(first);
      await wait(950); if(id!==run) return;
      first.classList.add("picked");
      el(pA,".cbadge").classList.add("on");
      hand.style.opacity = 0;
      oA.innerHTML = faceIcon("happy") + "Found it — added to cart"; oA.classList.add("show");
      setFace("happy", "Found it with Askmerce — and added it to the cart!");

      await wait(3200); if(id!==run) return;
      play((idx+1) % examples.length);
    }
    chips.forEach(function(c){ c.addEventListener("click", function(){ play(+c.dataset.i); }); });

    var started = false;
    var ioCompare = new IntersectionObserver(function(es){
      if(es[0].isIntersecting && !started){ started = true; play(0); }
    },{threshold:.3}).observe(document.getElementById("compare"));

    /* ---------- WALKTHROUGH PLAYER ---------- */
    var scenes = document.querySelectorAll(".scene"), chaps = document.querySelectorAll(".chap");
    var bars = document.querySelectorAll(".track b"), playBtn = document.getElementById("playBtn");
    var SCENE_MS = 6000, s = 0, t0 = 0, paused = false, elapsed = 0, raf;
    function countUp(sc){
      sc.querySelectorAll(".count").forEach(function(n){
        var to = +n.dataset.to, dur = +(n.dataset.dur || 3200), st = performance.now() + +(n.dataset.delay || 0);
        n.textContent = "0";
        (function step(now){ var p = Math.max(0, Math.min(1,(now-st)/dur)); n.textContent = Math.round(to*p); if(p<1 && sc.classList.contains("on")) requestAnimationFrame(step); })(st);
      });
    }
    function show(i){
      s = i; elapsed = 0; t0 = performance.now();
      scenes.forEach(function(sc,k){
        sc.classList.remove("on");
        if(k===i){ void sc.offsetWidth; sc.classList.add("on"); countUp(sc); }
      });
      chaps.forEach(function(c,k){ c.setAttribute("aria-current", String(k===i)); });
      bars.forEach(function(b,k){ b.style.width = k<i ? "100%" : "0"; });
    }
    function tick(now){
      if(!paused){
        elapsed = now - t0;
        bars[s].style.width = Math.min(100, elapsed/SCENE_MS*100) + "%";
        if(elapsed >= SCENE_MS) show((s+1) % scenes.length);
      }
      if(alive) raf = requestAnimationFrame(tick);
    }
    chaps.forEach(function(c){ c.addEventListener("click", function(){ show(+c.dataset.s); }); });
    playBtn.addEventListener("click", function(){
      paused = !paused;
      if(!paused) t0 = performance.now() - elapsed;
      scenes[s].querySelectorAll("*").forEach(function(n){ n.style.animationPlayState = paused ? "paused" : "running"; });
      document.getElementById("icPause").style.display = paused ? "none" : "";
      document.getElementById("icPlay").style.display = paused ? "" : "none";
      playBtn.setAttribute("aria-label", paused ? "Play walkthrough" : "Pause walkthrough");
    });
    var walkStarted = false;
    var ioWalk = new IntersectionObserver(function(es){
      if(es[0].isIntersecting && !walkStarted){ walkStarted = true; show(0); raf = requestAnimationFrame(tick); }
    },{threshold:.25}).observe(document.getElementById("walkthrough"));
    stops.push(function(){ run++; cancelAnimationFrame(raf); ioCompare.disconnect(); ioWalk.disconnect(); });
  })();

  return function stopLanding() {
    alive = false;
    stops.forEach(function (stop) { try { stop(); } catch (e) { /* already gone */ } });
  };
}
