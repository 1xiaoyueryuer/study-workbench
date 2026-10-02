// This file refines the existing visual chooser; all times are explicit sample data.
(() => {
  const paletteNames = ['山雾书房', '杏茶手帖', '湖蓝晨光'];
  const iconNames = ['Lucide', 'Phosphor', 'Tabler'];
  const nav = [
    ['clock.svg', '学习首页'], ['calendar.svg', '学习记录'],
    ['gift.svg', '奖励商店'], ['book.svg', '学习资料'], ['target.svg', '外观设置']
  ];
  document.querySelector('.intro').textContent = '主题随时可以修改。先看下面的首页布局，再继续挑配色与图标；这里的时间与水位都是视觉示例。';

  // Label the original thumbnails too, so every visible navigation has text.
  document.querySelectorAll('.theme').forEach(card => {
    const rail = card.querySelector('.rail');
    const folder = rail.querySelector('img').getAttribute('src').split('/').at(-2);
    rail.querySelectorAll('img').forEach(img => img.remove());
    nav.forEach(([file, label]) => {
      const row = document.createElement('div');
      row.className = 'rail-item';
      const img = document.createElement('img');
      img.src = `../../../public/assets/${folder}/${file}`; img.alt = '';
      const text = document.createElement('span'); text.textContent = label;
      row.append(img, text); rail.append(row);
    });
    card.querySelector('.banner small').textContent = '可用时长 · 示例';
    card.querySelector('.banner b').textContent = '36:48:00';
    const tiles = card.querySelectorAll('.tile');
    tiles[0].querySelector('label').textContent = '本次学习';
    tiles[1].querySelector('label').textContent = '累计学习';
    tiles[1].querySelector('.balance').innerHTML = '128 <small>小时</small>';
  });

  const section = document.createElement('section');
  section.className = 'workbench-section';
  section.innerHTML = `
    <div class="section-head"><h2>首页 · 让时间成为主角</h2><span class="hint">图标 + 文字导航 / 主题可随时调整</span></div>
    <div class="workbench">
      <aside class="workbench-nav"><div class="workbench-brand"><img alt="" data-icon="book.svg"><span>备考工作台</span></div><nav aria-label="首页布局示例导航"></nav><div class="workbench-nav-foot">每一秒，<br>都成为你的积累。<br><br>布局预览</div></aside>
      <div class="workbench-main">
        <div class="goal-strip"><div>目标考试<strong>2027 年 12 月 · 日期待设置</strong></div><div>目标院校<strong>待设置</strong></div><div>目标分数<strong>待设置</strong></div></div>
        <div class="time-resource"><div class="resource-label" id="primary-time-label">可用时长</div><div class="resource-number" id="primary-time">36:48:00</div><div class="resource-progress" id="time-state">慢慢积累，自有回响</div><div class="resource-description" id="time-description">可以用来兑换奖励的时间。每学习一秒，就多一秒。</div></div>
        <div class="home-stat-row"><div><span id="secondary-time-label">本次学习</span><b id="secondary-time">00:00:00</b></div><div>累计学习<b>128 时 12 分</b></div><div>今日学习<b>02 时 36 分</b></div></div>
        <div class="workbench-actions"><button type="button" class="preview-switch">查看学习中布局</button><span>切换布局示例，不启动实际计时，也不产生学习记录。</span></div>
        <div class="water-sketch" aria-hidden="true"></div><span class="water-drawing-label">水位构图示意 · 正式 3D 效果尚未实现</span>
      </div>
    </div><p class="preview-meta">待机突出可兑换余额；学习时突出本次计时，并保留余额与累计学习。正式版将以 Three.js 制作玻璃水缸、逐秒滴水和满水溢流。</p>`;
  document.querySelector('.hero').after(section);
  const bench = section.querySelector('.workbench');
  nav.forEach(([file, label], i) => {
    const row = document.createElement('div');
    row.className = `workbench-nav-item${i === 0 ? ' active' : ''}`;
    const img = document.createElement('img'); img.dataset.icon = file; img.alt = '';
    const text = document.createElement('span'); text.textContent = label;
    row.append(img, text); section.querySelector('nav').append(row);
  });

  function syncAppearance() {
    const choice = (saved && typeof saved === 'object') ? saved : {};
    bench.dataset.palette = paletteNames.includes(choice.theme) ? choice.theme : paletteNames[0];
    const folder = iconNames.includes(choice.icons) ? choice.icons : iconNames[0];
    section.querySelectorAll('[data-icon]').forEach(img => { img.src = `../../../public/assets/${folder}/${img.dataset.icon}`; });
  }
  document.querySelectorAll('.choose').forEach(button => button.addEventListener('click', syncAppearance));
  let runningLayout = false;
  section.querySelector('.preview-switch').addEventListener('click', event => {
    runningLayout = !runningLayout;
    bench.classList.toggle('is-running', runningLayout);
    section.querySelector('#primary-time-label').textContent = runningLayout ? '本次学习 · 目标 60 分钟（示例）' : '可用时长';
    section.querySelector('#primary-time').textContent = runningLayout ? '00:42:36' : '36:48:00';
    section.querySelector('#secondary-time-label').textContent = runningLayout ? '可用时长' : '本次学习';
    section.querySelector('#secondary-time').textContent = runningLayout ? '36:48:00' : '00:00:00';
    section.querySelector('#time-state').textContent = runningLayout ? '一秒一滴，正在积攒' : '慢慢积累，自有回响';
    section.querySelector('#time-description').textContent = runningLayout ? '进度 71% · 满水后仍可继续学习，直到手动结束。' : '可以用来兑换奖励的时间。每学习一秒，就多一秒。';
    event.currentTarget.textContent = runningLayout ? '查看待机布局' : '查看学习中布局';
  });
  syncAppearance();
})();
