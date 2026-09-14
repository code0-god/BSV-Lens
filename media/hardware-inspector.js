'use strict';

(function expose(root) {
    const t = (key, values) => root.BsvHardwareStrings?.t(key, values) || key.replace(/\{([A-Za-z]+)\}/g,
        (token, name) => Object.hasOwn(values || {}, name) ? String(values[name]) : token);
    function actionCaption(label) {
        for (const prefix of ['Behavior code: ', 'Update code: ', 'Call / argument context: ']) {
            if (label.startsWith(prefix)) return t(`${prefix}{name}`, { name: label.slice(prefix.length) });
        }
        return t(label);
    }
    function element(tag, text, className) {
        const node = document.createElement(tag);
        if (text !== undefined && text !== null) node.textContent = String(text);
        if (className) node.className = className;
        return node;
    }

    function textValue(value) {
        if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value);
        if (Array.isArray(value)) return value.map(textValue).join(', ');
        if (value && typeof value === 'object') return Object.entries(value).map(([key, item]) => `${key}: ${textValue(item)}`).join('; ');
        return '';
    }

    function render(scene, visit, handlers) {
        const title = document.getElementById('selection-title');
        const content = document.getElementById('inspector-content');
        const capabilities = document.getElementById('capability-content');
        const detail = scene.inspector;
        const inspectorKey = `${visit.sceneKind}:${detail?.id}:${visit.analysis?.result.queryId || ''}`;
        const savedInspector = visit.disclosureState.inspector;
        const scroll = savedInspector?.key === inspectorKey ? savedInspector.scrollTop
            : content.dataset.inspectorKey === inspectorKey ? document.getElementById('inspector').scrollTop : 0;
        content.dataset.inspectorKey = inspectorKey;
        title.textContent = detail?.title || scene.shell.label;
        const fragment = document.createDocumentFragment();
        const shownSources = new Set();
        const native = !!handlers.native;
        const disclosed = id => native ? visit.disclosureState.analysis?.disclosures?.[id] : visit.disclosureState[id];
        const module = [scene.shell, ...scene.children].find(item => `inspector:${item.id}` === detail?.id);
        const technical = native ? document.createDocumentFragment() : null;
        const primaryIdentity = new Set(['Selected path', 'Definition', 'Child instances', 'Storage', 'BSV owner']);
        const analysis = renderAnalysis(scene, visit, handlers);
        if (!native) fragment.append(analysis);
        if (detail) {
            if (detail.kind && !native) fragment.append(element('p', detail.kind, 'kind'));
            if (detail.subtitle && (!native || detail.subtitle !== detail.title)) fragment.append(element('p', detail.subtitle, 'type'));
            if (detail.path) fragment.append(element('p', detail.path, 'path'));
            if (detail.status && (!native || !['source-derived', 'verified-structure'].includes(detail.status))) fragment.append(element('span', detail.status, 'status-badge'));
            if (scene.correspondence.origin.claims.length) fragment.append(element('p',
                'Verified implementation contributor / Partial origin', 'status-badge contributor'));
            if (native) {
                const identity = element('dl');
                for (const field of detail.sections?.find(section => section.id === 'identity')?.fields || []) {
                    if (primaryIdentity.has(field.label) && textValue(field.value) !== detail.title) {
                        identity.append(element('dt', t(field.label)), element('dd', textValue(field.value)));
                    }
                }
                fragment.append(identity);
                const familyScope = module?.id === scene.shell.id ? scene.projection?.familyScope : null;
                if (familyScope) {
                    const family = element('section'); family.dataset.sectionId = 'family-element-view';
                    family.append(element('h3', t('Repeated family element')));
                    const fields = element('dl');
                    fields.append(element('dt', t('Element identity')), element('dd', familyScope.elementLabel),
                        element('dt', t('Index domain')), element('dd', familyScope.indexDomains.map(domain => domain.maxExclusive === null
                            ? `[0, ${domain.expression}) symbolic` : `[0, ${domain.maxExclusive})`).join(' × ')));
                    family.append(fields, element('p', t(familyScope.kind === 'symbolic-element'
                        ? 'This is a symbolic element view. Concrete indices require resolved dimensions.'
                        : familyScope.kind === 'indexed-representative'
                            ? 'This indexed representative uses the family’s shared source structure.'
                            : 'Choose a concrete index to inspect one family element.'), 'kind'));
                    if (familyScope.indexDomains.every(domain => Number.isSafeInteger(domain.maxExclusive)) && handlers.familyElement) {
                        const controls = element('div', null, 'family-element-controls'), inputs = [];
                        familyScope.indexDomains.forEach((domain, index) => {
                            const label = element('label', t('Index {index}', { index })), input = element('input');
                            input.type = 'number'; input.min = '0'; input.max = String(domain.maxExclusive - 1); input.step = '1';
                            input.value = String(familyScope.selectedIndices?.[index] ?? 0); input.dataset.familyIndex = String(index);
                            label.append(input); controls.append(label); inputs.push(input);
                        });
                        const open = element('button', t('View indexed representative')); open.type = 'button';
                        open.addEventListener('click', () => handlers.familyElement(inputs.map(input => Number(input.value))));
                        controls.append(open); family.append(controls);
                    }
                    fragment.append(family);
                }
                if (detail.connectionEssentials) {
                    const connection = detail.connectionEssentials, section = element('section');
                    section.dataset.sectionId = 'connection-essentials';
                    const fields = element('dl');
                    fields.append(element('dt', t('Relation family')), element('dd', t(connection.family)));
                    for (const [role, label] of [['from', 'Endpoint A'], ['to', 'Endpoint B']]) {
                        fields.append(element('dt', t(label)));
                        const values = element('dd'), list = element('ul', null, 'connection-endpoints');
                        for (const endpoint of connection[role]) {
                            const item = element('li', endpoint.label);
                            item.dataset.connectionEndpointRole = role; item.dataset.connectionEndpointId = endpoint.id;
                            item.title = [endpoint.ownerPath, (endpoint.interfacePath || []).join('.')].filter(Boolean).join(' / ');
                            list.append(item);
                        }
                        values.append(list); fields.append(values);
                    }
                    section.append(fields, element('p', t(connection.meaning === 'binding'
                        ? 'Binding or alias; no data-flow direction is asserted.'
                        : 'Source relation; this is not an RTL net.'), 'kind'),
                    element('p', t('Original relations: {count}', { count: connection.memberCount }), 'kind'));
                    fragment.append(section);
                }
                const actions = element('div', null, 'behavior-actions');
                if (module && module.id !== scene.shell.id && module.interaction?.kind === 'enter' && handlers.enter) {
                    const button = element('button', module.family
                        ? t(module.family.resolutionStatus === 'exact' ? 'Open family elements' : 'Open symbolic element view')
                        : t('Open {name}', { name: module.label }));
                    button.dataset.enterEntityId = module.id;
                    button.addEventListener('click', () => handlers.enter(module.id)); actions.append(button);
                }
                const ref = detail.sourceRefs?.find(item => item.range && item.id);
                if (ref && handlers.openSource) {
                    const button = element('button', t('Open source'));
                    button.dataset.sourceOpenId = ref.id;
                    button.addEventListener('click', () => handlers.openSource(ref)); actions.append(button);
                }
                fragment.append(actions);
                if (module?.id === scene.shell.id && scene.children.length) {
                    const children = element('section'); children.dataset.sectionId = 'direct-children';
                    children.append(element('h3', t('Direct children')));
                    const list = element('div', null, 'behavior-actions');
                    for (const child of scene.children) {
                        const row = element('div', null, 'module-actions');
                        const button = element('button', child.label);
                        button.dataset.childEntityId = child.id;
                        button.title = child.interaction?.kind === 'enter' ? t('Open {name}', { name: child.label }) : child.status;
                        button.addEventListener('click', () => child.interaction?.kind === 'enter' && handlers.enter
                            ? handlers.enter(child.id) : handlers.select(child.id, false)); row.append(button);
                        if (child.interaction?.kind === 'enter') {
                            const info = element('button', t('Details'));
                            info.dataset.inspectEntityId = child.id;
                            info.setAttribute('aria-label', t('Details for {name}', { name: child.label }));
                            info.addEventListener('click', () => handlers.select(child.id, false)); row.append(info);
                        }
                        list.append(row);
                    }
                    children.append(list); fragment.append(children);
                }
                if (module?.id === scene.shell.id) {
                    const groups = (scene.interfaceGroups || []).filter(item => item.ownerId === module.id);
                    if (groups.length) {
                        const interfaces = element('section'); interfaces.dataset.sectionId = 'module-interfaces';
                        interfaces.append(element('h3', t('Interfaces')));
                        const list = element('div', null, 'behavior-actions');
                        for (const group of groups) {
                            const button = element('button', group.label); button.dataset.interfaceMemberId = group.id;
                            button.title = (group.interfacePath || []).join('.');
                            button.addEventListener('click', () => handlers.select(group.id, false)); list.append(button);
                        }
                        interfaces.append(list); fragment.append(interfaces);
                    }
                }
                if (detail.interfaceMembers?.length) {
                    const members = element('section'); members.dataset.sectionId = 'interface-members';
                    members.append(element('h3', t('Member methods')));
                    const list = element('div', null, 'behavior-actions');
                    for (const member of detail.interfaceMembers) {
                        const button = element('button', member.label);
                        button.dataset.interfaceMemberId = member.id;
                        button.title = [(member.interfacePath || []).join('.'), member.category].filter(Boolean).join(' / ');
                        button.addEventListener('click', () => handlers.select(member.id, false)); list.append(button);
                    }
                    members.append(list); fragment.append(members);
                }
                if (detail.relationMembers?.length) {
                    const id = `inspector-relations:${detail.id}`, container = element('details');
                    container.dataset.disclosureId = id;
                    container.open = disclosed(id) ?? !!(detail.connectionEssentials && detail.relationMembers.length <= 16);
                    container.append(element('summary', t(detail.connectionEssentials ? 'Original relations ({count})'
                        : 'Connections and code ({count})', { count: detail.relationMembers.length })));
                    let open = container.open, populated = false;
                    const populate = () => {
                        if (populated) return;
                        populated = true;
                        const list = element('div', null, 'behavior-actions');
                        for (const relation of detail.relationMembers) {
                            const button = element('button', relation.label || relation.kind);
                            button.dataset.relationMemberId = relation.id;
                            button.title = `${relation.kind}: ${relation.fromLabel || relation.fromId} / ${relation.toLabel || relation.toId}`;
                            button.addEventListener('click', () => handlers.select(relation.id, true)); list.append(button);
                        }
                        container.append(list);
                    };
                    if (open) populate();
                    container.addEventListener('toggle', () => {
                        if (open === container.open) return;
                        open = container.open;
                        if (open) populate();
                        handlers.disclose(id, open);
                    });
                    fragment.append(container);
                }
                fragment.append(analysis);
            }
            for (const section of detail.sections || []) {
                const container = element('section');
                container.dataset.sectionId = section.id;
                if (section.title) container.append(element('h3', t(section.title)));
                if (section.text) container.append(element('p', t(section.text)));
                if (section.status) container.append(element('span', section.status,
                    `status-badge${section.status.includes('contributor') ? ' contributor' : ''}`));
                if (section.fields?.length) {
                    const list = element('dl');
                    for (const field of section.fields) {
                        if (native && section.id === 'identity' && primaryIdentity.has(field.label) && textValue(field.value) !== detail.title) continue;
                        list.append(element('dt', t(field.label)), element('dd', textValue(field.value)));
                        if (field.status && field.status !== 'source-derived' && field.status !== field.value) list.append(element('dd', field.status, 'kind'));
                    }
                    container.append(list);
                }
                for (const ref of section.sourceRefs || []) container.append(source(ref));
                if (section.actions?.length) {
                    const group = element('div', null, 'behavior-actions');
                    for (const action of section.actions) {
                        const button = element('button', t(action.label));
                        button.dataset.entityId = action.id;
                        if (action.kind === 'disclosure') {
                            button.setAttribute('aria-expanded', String(action.open));
                            button.addEventListener('click', () => handlers.toggleDetail(action.id));
                        } else button.addEventListener('click', () => handlers.select(action.id, !!action.relation));
                        group.append(button);
                    }
                    container.append(group);
                }
                if (section.items?.length) {
                    const list = element('ul');
                    for (const item of section.items) list.append(element('li', textValue(item)));
                    container.append(list);
                }
                const advanced = native && (['identity', 'origin', 'signal-disclosure', 'rtl-signals', 'aliases'].includes(section.id)
                    || module && section.id.startsWith('behavior:'));
                (advanced ? technical : fragment).append(container);
            }
            for (const ref of detail.sourceRefs || []) fragment.append(source(ref));
            if (native && technical.childNodes.length) {
                const id = `inspector-details:${detail.id}`, container = element('details');
                container.dataset.disclosureId = id; container.open = !!disclosed(id);
                let open = container.open;
                container.append(element('summary', t('Source and implementation details')), technical);
                container.addEventListener('toggle', () => { if (open !== container.open) {
                    open = container.open; handlers.disclose(id, open);
                } });
                fragment.append(container);
            }
        }
        content.replaceChildren(fragment);
        for (const pre of content.querySelectorAll('[data-code-scroll-id]')) {
            const saved = visit.disclosureState.analysis?.codeScroll?.[pre.dataset.codeScrollId];
            pre.scrollTop = saved?.top || 0; pre.scrollLeft = saved?.left || 0;
        }
        const capabilityFragment = document.createDocumentFragment();
        for (const provider of scene.capabilities?.providers || []) {
            capabilityFragment.append(element('h3', provider.label), element('p', provider.status, 'kind'));
        }
        const entries = Array.isArray(scene.capabilities) ? scene.capabilities : scene.capabilities?.items || [];
        const list = element('ul', null, 'capability-list');
        for (const capability of entries) {
            list.append(element('li', `${capability.label}: ${capability.status}`));
        }
        capabilityFragment.append(list);
        if (scene.correspondence?.completeOriginStatus) {
            capabilityFragment.append(element('p', scene.correspondence.completeOriginStatus));
        }
        capabilities.replaceChildren(capabilityFragment);
        document.getElementById('inspector').scrollTop = scroll;

        function source(ref) {
            const id = `source:${ref.pathRef}:${ref.range?.start}:${ref.range?.end}`;
            if (shownSources.has(id)) return document.createDocumentFragment();
            shownSources.add(id);
            const container = element('details', null, 'source-evidence');
            container.dataset.disclosureId = id;
            container.open = disclosed(id) ?? (native ? false : detail.sourceExpanded);
            let lastOpen = container.open;
            container.append(element('summary', t('Source: {path}', { path: ref.pathRef })));
            container.append(element('pre', ref.range?.text ?? ref.text ?? ''));
            if (ref.range) container.append(element('p', `UTF-16 [${ref.range.start}, ${ref.range.end})`, 'evidence-location'));
            if (ref.revision || ref.contentHash) {
                container.append(element('p', `Captured revision ${ref.revision || ref.contentHash}`, 'evidence-location'));
            }
            container.addEventListener('toggle', () => {
                if (lastOpen === container.open) return;
                lastOpen = container.open;
                handlers.disclose(id, container.open, ref);
            });
            return container;
        }
    }
    function renderAnalysis(scene, visit, handlers) {
        const section = element('section', null, 'analysis-section');
        section.dataset.sectionId = 'electrical-analysis';
        const selectedId = visit.selectedRelationId || visit.selectedEntityId;
        const choices = BsvHardwareAnalysis.seedChoices(scene, selectedId);
        const sourceActions = BsvHardwareAnalysis.sourceActions(scene, visit);
        const saved = visit.disclosureState.analysis || {};
        const lens = ['structure', 'value', 'control'].includes(saved.lens) ? saved.lens : 'structure';
        let controls = saved.controls?.selectionId === selectedId ? saved.controls : { selectionId: selectedId };
        const choice = choices.find(c => c.id === controls.choiceId) || (choices.length === 1 ? choices[0] : null);
        const result = visit.analysis?.result;
        if (!choices.length && !sourceActions.length && !result) return section;
        section.append(element('h3', t('Hardware analysis')));
        const feedback = element('p', '', 'analysis-feedback');
        feedback.id = 'analysis-feedback'; feedback.setAttribute('role', 'status'); feedback.setAttribute('aria-live', 'polite');
        section.append(feedback);
        function button(label, action, parent = section) {
            const b = element('button', t(label)); b.type = 'button'; b.addEventListener('click', action); parent.append(b); return b;
        }
        function patchControls(changes, repaint = true) {
            controls = { ...controls, ...changes };
            handlers.patchAnalysis({ controls }, repaint);
        }
        function disclosure(id, label, parent = section) {
            const d = element('details'); d.dataset.analysisDisclosureId = id;
            d.open = !!saved.disclosures?.[id];
            let lastOpen = d.open;
            d.append(element('summary', label));
            d.addEventListener('toggle', () => {
                if (lastOpen === d.open) return;
                lastOpen = d.open;
                handlers.analysisDisclosure(id, d.open);
            });
            parent.append(d); return d;
        }
        if (scene.sceneKind === 'bsv' && selectedId) {
            const lenses = element('div', null, 'analysis-lenses'); lenses.setAttribute('role', 'group');
            lenses.setAttribute('aria-label', t('Analysis lens'));
            for (const [id, label] of [['structure', 'Structure'], ['value', 'Value'], ['control', 'Control']]) {
                const lensButton = button(label, () => handlers.patchAnalysis({ lens: id }), lenses);
                lensButton.dataset.analysisLens = id; lensButton.setAttribute('aria-pressed', String(lens === id));
            }
            section.append(lenses, element('p', t(({ structure: 'Structure shows declared hardware and containment.',
                value: 'Value shows reads, writes, expressions, and call bindings.',
                control: 'Control shows source guards, body conditions, and update behavior.' })[lens]), 'kind'));
        }
        const visibleSourceActions = sourceActions.filter(action => lens === 'value'
            ? ['state-accesses', 'source-dependencies', 'call-site'].includes(action.kind)
            : lens === 'control' ? action.kind === 'behavior' : action.kind === 'correspondence');
        if (visibleSourceActions.length) {
            const actions = element('div', null, 'behavior-actions'); section.append(actions);
            for (const action of visibleSourceActions) {
                const caption = actionCaption(action.label);
                const b = button(action.needsOwner ? t('Open source owner: {name}', { name: caption }) : caption, () => {
                    if (action.needsOwner) return handlers.sourceOwner(action.ownerInstanceId, action.entityId);
                    return handlers.analyze(BsvHardwareAnalysis.sourceInput(scene, action, null, saved.sourceMode || 'build'));
                }, actions);
                b.dataset.sourceEntityId = action.entityId; b.dataset.analysisEntityId = action.entityId; b.dataset.analysisKind = action.kind;
                b.disabled = handlers.analysisContext?.capabilities?.[action.kind] !== 'available';
            }
            const label = element('label', t('Source mode')), mode = element('select');
            for (const [value, caption] of [['build', 'Captured build source'], ['current-source', 'Current source (freshness checked)']]) {
                const option = element('option', t(caption)); option.value = value; mode.append(option);
            }
            mode.value = saved.sourceMode || 'build'; mode.dataset.sourceMode = 'true';
            mode.addEventListener('change', () => handlers.patchAnalysis({ sourceMode: mode.value }));
            label.append(mode);
            (handlers.native ? disclosure('source-options', t('Source options')) : section).append(label);
            if (!handlers.analysisContext?.capabilities) section.append(element('p', handlers.analysisContext?.error
                ? `Source analysis unavailable: ${handlers.analysisContext.error}` : 'Reading attached source capabilities', 'kind'));
        }
        if (scene.sceneKind === 'bsv' && choices.length) {
            section.append(element('p', 'Verified RTL signal choices. Opening a signal is a connectivity action, not an origin claim.', 'kind'));
            for (const c of choices) {
                const b = button(`Inspect RTL ${c.label} [${c.positions.length}]`, () => handlers.revealAnalysis(c.reveal));
                b.dataset.analysisSignalId = c.reveal.entityId;
            }
        } else if (choices.length) {
            if (choices.length > 1) {
                section.append(element('p', 'Choose an actual pin; cell inputs and outputs are not one net.', 'kind'));
                const pins = element('div', null, 'behavior-actions'); section.append(pins);
                for (const c of choices) {
                    const b = button(`${c.label} / ${c.direction || 'net'} [${c.positions.length}]`, () => patchControls({ choiceId: c.id }), pins);
                    b.dataset.analysisPinId = c.entityId || c.id;
                    b.setAttribute('aria-pressed', String(choice?.id === c.id));
                }
            }
            if (choice) {
                section.append(element('p', `Seed: ${choice.label} / ${choice.positions.length} ordered positions`));
                if (choice.mappedActual) section.append(element('p', 'Drawn child formal mapped through recorded incidence to the parent actual.', 'kind'));
                if (choice.status === 'unconnected') section.append(element('p', 'Unconnected actual. No parent net is available; inspect the child formal separately.'));
                if (choice.reveal) button('Reveal child formal', () => handlers.revealAnalysis(choice.reveal));
                if (choice.status === 'available') {
                    const form = element('div', null, 'analysis-controls'); section.append(form);
                    const field = (label, control) => { const l = element('label', label); l.append(control); form.append(l); return control; };
                    const select = (label, values, value, onChange) => {
                        const s = field(label, element('select'));
                        for (const [id, caption] of values) { const option = element('option', caption); option.value = id; s.append(option); }
                        s.value = value; s.addEventListener('change', () => onChange(s.value)); return s;
                    };
                    const mode = controls.mode || 'all';
                    select('Positions', [['all', 'Whole ordered vector'], ['indices', 'Ordered bit positions'], ['slice', 'Positional slice [start, end)']],
                        mode, value => patchControls({ mode: value }));
                    const input = (label, key, value, type) => {
                        const n = field(label, element('input')); n.type = type; n.value = value;
                        if (type === 'number') { n.min = '0'; n.max = String(choice.positions.length); n.step = '1'; }
                        else { n.placeholder = '0, 2, 1, 2'; n.maxLength = 16384; }
                        n.addEventListener('change', () => patchControls({ [key]: n.value }, false)); return n;
                    };
                    const indices = mode === 'indices' ? input('Zero-based positions (order and repeats kept)', 'indices', controls.indices ?? '0', 'text') : null;
                    const start = mode === 'slice' ? input('Start position', 'start', controls.start ?? 0, 'number') : null;
                    const end = mode === 'slice' ? input('End position (exclusive)', 'end', controls.end ?? choice.positions.length, 'number') : null;
                    const scope = select('Analysis scope', [['design', 'Design'], ['subtree', 'Current RTL subtree'], ['occurrence', 'Current RTL occurrence']],
                        controls.scope || 'design', value => patchControls({ scope: value }, false));
                    section.append(element('p', `Ordered values: [${choice.positions.map(p => p.bitId ? p.value : 'open').join(', ')}]`, 'kind'));
                    const actions = element('div', null, 'behavior-actions'); section.append(actions);
                    for (const [kind, label, direction] of [['same-net', 'Same net'], ['drivers-loads', 'Drivers / loads'],
                        ['dependencies', 'Input dependencies', 'backward'], ['dependencies', 'Output dependents', 'forward']]) {
                        const b = button(label, () => {
                            try {
                                let positions;
                                if (mode === 'all') positions = choice.positions.map((_, i) => i);
                                else if (mode === 'indices') {
                                    if (!/^\s*\d+(\s*,\s*\d+)*\s*$/.test(indices.value)) throw new Error('Enter comma-separated zero-based positions');
                                    positions = indices.value.split(',').map(Number);
                                } else {
                                    const a = Number(start.value), z = Number(end.value);
                                    if (!start.value || !end.value || !Number.isSafeInteger(a) || !Number.isSafeInteger(z)
                                        || a < 0 || z <= a || z > choice.positions.length) throw new Error('Slice must be non-empty and within the ordered vector');
                                    positions = Array.from({ length: z - a }, (_, i) => a + i);
                                }
                                const seed = BsvHardwareAnalysis.seedInput(choice, positions);
                                const context = scene.implementationContext;
                                handlers.analyze({ kind, seed, ...(direction ? { direction, semanticsProfile: 'yosys-0.68-structural-v1' } : {}), scope: { kind: scope.value,
                                    rootOccurrenceId: scope.value === 'design' ? context.rootOccurrenceId : context.contextOccurrenceId } });
                            } catch (error) { feedback.textContent = error.message; feedback.classList.add('error'); }
                        }, actions);
                        b.dataset.analysisKind = kind;
                        if (direction) b.dataset.analysisDirection = direction;
                        b.disabled = handlers.analysisContext?.capabilities?.[kind] !== 'available';
                    }
                    if (!handlers.analysisContext?.capabilities) section.append(element('p', handlers.analysisContext?.error
                        ? `Analysis unavailable: ${handlers.analysisContext.error}` : 'Reading attached analysis capabilities', 'kind'));
                }
            }
        }
        if (!result) return section;
        if (BsvHardwareAnalysis.isSourceResult(result)) {
            section.append(renderCode(scene, visit, handlers));
            return section;
        }
        const projection = handlers.analysisProjection;
        const names = new Map(result.objects.map(o => [o.entityId, o.name ?? o.value ?? o.objectKind]));
        const seedName = names.get(result.seed.entityId) || 'Ordered electrical vector';
        const heading = element('section', null, 'analysis-result'); section.append(heading);
        heading.dataset.queryId = result.queryId;
        heading.append(element('h3', result.kind === 'dependencies'
            ? result.direction === 'backward' ? 'Input dependencies' : 'Output dependents'
            : result.kind === 'same-net' ? 'Same net result' : 'Drivers / loads result'),
            element('p', `${result.status} / ${result.availability}; completeness: ${result.completeness}`, 'status-badge'),
            element('p', `Seed: ${seedName}; positions [${result.seed.positions.map(p => p.index).join(', ')}]`),
            element('p', `Scope: ${result.scope.kind} / ${result.scope.rootOccurrenceId === scene.implementationContext.rootOccurrenceId ? 'actual design root' : 'selected RTL occurrence'}`),
            element('p', `BSV: ${scene.sourceContext?.occurrencePath?.join('.') || 'Not attached'} | RTL: ${scene.implementationContext.occurrencePath.join('/')} | ${result.context.implementationProvider}`, 'kind'),
            element('p', `Stage: ${result.context.stage ?? 'unknown'}; freshness: ${result.context.freshness ?? 'unknown'}`, 'kind'));
        const stopping = [...new Set([...(result.limits.stopReasons || []), ...result.frontier.map(f => f.reason)])];
        heading.append(element('p', `Stopping: ${stopping.length ? stopping.join(', ') : 'none; requested scope completed'}`));
        const counts = element('p', '', 'kind'); counts.id = 'analysis-counts'; heading.append(counts);
        updateAnalysisCounts(projection.counts, counts);
        heading.append(element('p', 'Canvas: thick = result; long dash = seed; short dash = boundary. Unrelated hardware stays readable.', 'kind'));
        if (result.kind === 'dependencies') {
            heading.append(element('p', 'Conservative structural dependencies, not simulation, active paths or source origin.'));
            const data = result.relations.filter(item => item.kind === 'data-dependency').length;
            const control = result.relations.filter(item => item.kind === 'control-dependency').length;
            heading.append(element('p', `${data} data dependencies / ${control} control dependencies / ${result.boundaries.length} stops`));
            const boundaryLimit = saved.boundaryLimit || 16;
            for (const boundary of result.boundaries.slice(0, boundaryLimit)) {
                const description = result.cellDescriptions.find(item => item.cellId === boundary.cellId);
                const d = disclosure(`${result.queryId}:boundary:${boundary.id}`,
                    `${description?.type || 'Contact'} / ${names.get(boundary.at?.entityId) || boundary.at?.objectKind || 'frontier'}: ${boundary.reason}`, heading);
                if (boundary.side) d.append(element('p', `Side: ${boundary.side}`));
                if (boundary.clock) d.append(element('p', `Clock edge: ${boundary.clock.edge}; polarity ${boundary.clock.polarity}`));
                if (description) {
                    d.append(element('p', `${description.status} / ${description.precision || description.classification}`));
                    if (description.limitations?.length) d.append(element('p', description.limitations.join('; '), 'kind'));
                }
                if (BsvHardwareAnalysis.canReveal(boundary.at)) {
                    button('Inspect boundary', () => handlers.revealAnalysis(boundary.at), d);
                }
                d.append(element('pre', JSON.stringify(boundary, null, 2)));
            }
            if (result.boundaries.length > boundaryLimit) button(`Show next stops (${result.boundaries.length - boundaryLimit} retained)`,
                () => handlers.patchAnalysis({ boundaryLimit: boundaryLimit + 16 }), heading);
            const descriptions = disclosure(`${result.queryId}:semantics`, `Cell semantics (${result.cellDescriptions.length})`, heading);
            descriptions.append(element('pre', JSON.stringify(result.cellDescriptions, null, 2)));
        }
        const groups = result.groups || [], groupLimit = saved.groupLimit || 16;
        for (const group of groups.slice(0, groupLimit)) {
            const d = disclosure(`${result.queryId}:position:${group.seed.position}`,
                `Position ${group.seed.position} (index ${group.seed.index}, value ${names.get(group.seed.bitId) ?? 'unknown'}): ${result.kind === 'dependencies' ? 'dependency scope' : `membership ${group.membership}`}; interpretation ${group.interpretation}`, heading);
            if (result.kind === 'dependencies') {
                d.append(element('p', `${group.bitIds.length} bits / ${group.relationIds.length} relations / ${group.boundaryIds.length} stops`));
                d.append(element('pre', JSON.stringify(group, null, 2)));
                continue;
            }
            d.append(element('p', `${group.bitIds.length} bits / ${group.incidences.length} incidences / ${group.boundaryIds.length} crossings`));
            for (const [key, label] of [['drivers', 'Driver candidates'], ['loads', 'Load candidates'],
                ['boundaryContacts', 'Boundary contacts'], ['unknownContacts', 'Unknown / bidirectional contacts']]) {
                const terminals = group[key]; d.append(element('h3', `${label} (${terminals.length})`));
                if (!terminals.length) d.append(element('p', 'None returned', 'kind'));
                for (const terminal of terminals.slice(0, 32)) {
                    const row = element('p', `${names.get(terminal.entityId) ?? terminal.objectKind} [${terminal.index ?? 'literal'}] / ${terminal.role}`);
                    d.append(row);
                }
                if (terminals.length > 32) d.append(element('p', `${terminals.length - 32} additional contacts retained in canonical group records`, 'kind'));
            }
            const raw = disclosure(`${result.queryId}:raw:${group.seed.position}`, 'Canonical group records', d);
            raw.append(element('pre', JSON.stringify(group, null, 2)));
        }
        if (groups.length > groupLimit) button(`Show next positions (${groups.length - groupLimit} retained)`,
            () => handlers.patchAnalysis({ groupLimit: groupLimit + 16 }), heading);
        heading.append(element('h3', 'Returned references'));
        const referenceLimit = saved.referenceLimit || 32;
        for (const ref of projection.references.slice(0, referenceLimit)) {
            const row = element('div', null, 'analysis-reference'); heading.append(row);
            const caption = `${names.get(ref.entityId) ?? ref.objectKind} / ${ref.objectKind} / ${ref.visibility}`;
            const choose = button(caption, () => handlers.patchAnalysis({ resultSelection: ref.entityId }), row);
            choose.dataset.analysisReferenceId = ref.entityId;
            choose.setAttribute('aria-pressed', String(saved.resultSelection === ref.entityId));
            const intent = BsvHardwareAnalysis.canReveal(ref);
            if (intent) {
                const b = button(ref.visibility === 'visible' ? 'Inspect' : 'Reveal', () => handlers.revealAnalysis(ref), row);
                b.dataset.analysisRevealId = ref.entityId;
            }
            if (!intent) row.append(element('p', 'No actual hardware target is supplied for this reference.', 'kind'));
            if (saved.resultSelection === ref.entityId) row.append(element('pre', JSON.stringify(ref, null, 2)));
        }
        if (projection.references.length > referenceLimit) button(`Show next references (${projection.references.length - referenceLimit} retained)`,
            () => handlers.patchAnalysis({ referenceLimit: referenceLimit + 32 }), heading);
        for (const candidate of result.candidates) button(`Choose ${names.get(candidate.entityId) || candidate.objectKind}`,
            () => handlers.revealAnalysis(candidate), heading);
        const raw = disclosure(`${result.queryId}:raw`, 'Full canonical result and frontier', heading);
        raw.append(element('pre', JSON.stringify(result, null, 2)));
        return section;
    }
    function renderCode(scene, visit, handlers) {
        const { result, request } = visit.analysis, code = result.code, saved = visit.disclosureState.analysis || {};
        const section = element('section', null, 'analysis-result code-analysis'); section.dataset.queryId = result.queryId;
        const kindLabel = handlers.native ? t(({ 'state-accesses': 'Readers / writers', behavior: 'Behavior code',
            'call-site': 'Call context', 'source-dependencies': 'Input source dependencies', correspondence: 'Explain implementation mapping' })[result.kind] || result.kind) : result.kind;
        section.append(element('h3', `${kindLabel} / ${code.entity?.name || code.entity?.text || code.entity?.kind || 'source'}`),
            element('p', `${result.status} / ${result.availability}; completeness: ${result.completeness}`, 'status-badge'),
            element('p', `${t('BSV owner')}: ${code.owner?.path || 'source-only callable'}; ${t(code.sourceMode === 'current-source' ? 'Current source' : 'Captured build source')}; freshness: ${code.freshness.status}`, 'kind'));
        if (!handlers.native || result.seed.occurrenceId) section.append(element('p',
            `Scope: ${request.scope.kind}; RTL: ${result.seed.occurrenceId ? scene.implementationContext.occurrencePath.join('/') : 'not attached'}; ${result.context.implementationProvider}; stage: ${result.context.stage || 'unknown'}`, 'kind'));
        const stops = [...new Set([...result.limits.stopReasons, ...result.frontier.map(f => f.reason)])];
        section.append(element('p', `Stopping: ${stops.join(', ') || 'none; requested source scope completed'}`));
        const counts = element('p', null, 'kind'); counts.id = 'analysis-counts'; section.append(counts);
        updateAnalysisCounts(handlers.analysisProjection.counts, counts);
        function button(label, callback, parent = section) {
            const b = element('button', t(label)); b.type = 'button'; b.addEventListener('click', callback); parent.append(b); return b;
        }
        function group(id, title) {
            const s = element('section'); s.dataset.codeSection = id; s.append(element('h3', t(title))); section.append(s); return s;
        }
        function raw(id, caption, value, parent = section) {
            const d = element('details'); d.dataset.analysisDisclosureId = `${result.queryId}:${id}`;
            d.open = !!saved.disclosures?.[d.dataset.analysisDisclosureId]; let open = d.open;
            d.append(element('summary', caption), element('pre', JSON.stringify(value, null, 2)));
            d.addEventListener('toggle', () => { if (open !== d.open) { open = d.open; handlers.analysisDisclosure(d.dataset.analysisDisclosureId, open); } });
            parent.append(d); return d;
        }
        function analyze(action, parent, caption = action.label) {
            const b = button(caption, () => handlers.analyze(BsvHardwareAnalysis.sourceInput(scene, action, visit.analysis, saved.sourceMode || code.sourceMode)), parent);
            b.dataset.sourceEntityId = action.entityId; b.dataset.analysisEntityId = action.entityId; b.dataset.analysisKind = action.kind;
            if (action.kind === 'source-dependencies') b.dataset.analysisDirection = action.direction || 'backward';
            b.disabled = handlers.analysisContext?.capabilities?.[action.kind] !== 'available';
            if (action.ownerInstanceId !== result.seed.ownerInstanceId && !Object.hasOwn(action, 'occurrenceId') && request.scope.kind !== 'source-only') {
                b.disabled = true; b.title = 'No actual source-owner occurrence supplied for this record';
            }
            return b;
        }
        const records = BsvHardwareAnalysis.codeRecords(result);
        const drawer = element('details', null, 'code-drawer'); drawer.id = 'code-drawer';
        drawer.open = saved.codeOpen !== false; let drawerOpen = drawer.open;
        drawer.append(element('summary', t('Code Drawer / read-only original source')));
        drawer.addEventListener('toggle', () => { if (drawerOpen !== drawer.open) { drawerOpen = drawer.open; handlers.patchAnalysis({ codeOpen: drawer.open }, false); } });
        section.append(drawer);
        if (code.storage) {
            const storage = group('storage', 'Declared storage');
            const fields = element('dl');
            for (const [name, value] of [['Type', code.storage.declaredType], ['Constructor', code.storage.constructor],
                ['Initializer', code.storage.defaultExpressions || code.storage.arguments || []]]) fields.append(element('dt', name), element('dd', textValue(value)));
            storage.append(fields);
        }
        for (const [role, label] of [['reader', 'Readers'], ['writer', 'Writers']]) {
            if (result.kind !== 'state-accesses') continue;
            const s = group(role, label), items = records.filter(r => r.role === role);
            if (!items.length) s.append(element('p', 'None returned', 'kind'));
            for (const record of items) analyze(record, s);
        }
        const predicate = group('predicate', 'Explicit predicate');
        predicate.append(element('p', result.conditions.predicate?.text || 'Not present; readiness is separate'));
        const conditions = group('body-conditions', 'Signed body conditions');
        if (!result.conditions.body.length) conditions.append(element('p', 'None recorded', 'kind'));
        for (const c of result.conditions.body) {
            const row = element('p', `${c.polarity ? '' : 'not '}(${c.text || c.expressionId}) / not evaluated`);
            row.dataset.signedExpressionId = c.signedExpressionId; row.dataset.polarity = String(c.polarity); conditions.append(row);
        }
        if (result.conditions.caseArms?.length) {
            const cases = group('case-conditions', 'Case arm conditions');
            for (const condition of result.conditions.caseArms) {
                const selector = condition.selector?.text || condition.selectorExpressionId;
                const labels = (condition.labels || []).map((label) => label.text).join(', ');
                const excluded = (condition.priorLabels || []).map((label) => label.text).join(', ');
                const description = condition.kind === 'case-default'
                    ? `${selector}: default after no prior match${excluded ? ` (${excluded})` : ''}`
                    : `${selector} matches ${labels || 'unresolved label'}`;
                const row = element('p', `${description} / not evaluated`);
                row.dataset.caseArmId = condition.armId; row.dataset.caseSemantics = condition.semantics;
                cases.append(row);
            }
        }
        const absentReadiness = handlers.native && code.readiness.status === 'not-attached' && !code.readiness.evidence.length;
        const absentCompilerSchedule = handlers.native && code.scheduling.compiler.status === 'not-attached' && !code.scheduling.compiler.relations.length;
        if (absentReadiness || absentCompilerSchedule) raw('unattached-evidence', t('Evidence details'), {
            ...(absentReadiness ? { readiness: code.readiness } : {}),
            ...(absentCompilerSchedule ? { compilerScheduling: code.scheduling.compiler } : {})
        });
        if (!absentReadiness) {
            const readiness = group('readiness', 'Readiness evidence'); readiness.append(element('p', code.readiness.status));
            if (code.readiness.evidence.length) raw('readiness', 'Readiness records', code.readiness.evidence, readiness);
        }
        if (!absentCompilerSchedule || code.scheduling.sourceRelations.length || code.scheduling.potentialDependencies.length) {
            const scheduling = group('scheduling', 'Scheduling evidence');
            if (!absentCompilerSchedule) scheduling.append(element('p', `Compiler: ${code.scheduling.compiler.status}`));
            for (const [key, label, value] of [['compiler-schedule', 'Compiler schedule', code.scheduling.compiler.relations],
                ['source-schedule', 'Source scheduling records', code.scheduling.sourceRelations], ['potential-schedule', 'Potential source dependencies (not compiler scheduling)', code.scheduling.potentialDependencies]]) {
                if (value.length) raw(key, `${label} (${value.length})`, value, scheduling);
            }
        }
        const assertions = group('assertions', 'Assertions'); assertions.append(element('p', `${code.assertions.length} source assertions`));
        for (const assertion of code.assertions) assertions.append(element('pre', assertion.text));
        const effects = group('state-effects', 'State effects'); effects.append(element('p', `${code.stateEffects.length} source effects`));
        for (const effect of code.stateEffects) effects.append(element('p', textValue(effect)));
        for (const [index, mapping] of result.callMappings.entries()) {
            const s = group(`call:${index}`, mapping.callSite?.text || mapping.binding?.sourceText || 'Call context');
            s.append(element('p', `${mapping.resolution}${mapping.reason ? ` / ${mapping.reason}` : ''}`, 'status-badge'));
            for (const [role, label, value] of [['caller', 'Caller', mapping.caller], ['producer', 'Producer', mapping.producer],
                ['consumer', 'Consumer', mapping.consumer], ['actual-formal', 'Actual / formal arguments', mapping.actualToFormal]]) {
                const row = element('section'); row.dataset.codeContext = role;
                row.append(element('h3', label)); s.append(row);
                if (role === 'actual-formal') for (const a of value) row.append(element('p', `[${a.formalIndex}] ${a.actual?.text || a.actualExpressionId} -> ${a.formalName || a.formal?.name} : ${a.formal?.type || 'unknown type'}`));
                else {
                    const entries = Array.isArray(value) ? value : value ? [value] : [];
                    if (!entries.length) row.append(element('p', 'Not resolved', 'kind'));
                    for (const entry of entries) {
                        const owner = result.objects.find(o => o.entityId === entry.ownerInstanceId);
                        row.append(element('p', `${owner?.record.path || entry.ownerInstanceId || 'source-only helper'} / ${entry.binding?.memberPath || entry.behaviorId || entry.endpointId || entry.definitionId || 'unknown'}`, 'kind'));
                    }
                }
            }
            s.append(element('p', `Returns: ${mapping.returnAvailability}; result binding: ${mapping.resultBinding?.text || mapping.resultBinding?.name || (mapping.resultBinding ? textValue(mapping.resultBinding) : 'none recorded')}`));
            raw(`call:${index}`, 'Canonical call context and unresolved candidates', mapping, s);
        }
        const selection = records.find(r => r.id === saved.codeSelection) || records.find(r => r.entityId === result.seed.entityId) || records[0];
        const limit = saved.codeLimit || 32;
        if (selection) {
            drawer.append(element('h3', `${selection.role}: ${selection.label}`));
            analyze(selection, drawer, selection.kind === 'call-site' ? 'Analyze call context' : selection.kind === 'behavior' ? 'Analyze behavior' : 'Input source dependencies');
            if (selection.kind === 'source-dependencies') analyze({ ...selection, direction: 'forward' }, drawer, 'Output source dependents');
            analyze({ ...selection, kind: 'correspondence' }, drawer, 'Explain implementation mapping');
        }
        const primaryRef = selection?.reference || result.sourceRefs.find(r => r.semanticId === result.seed.entityId);
        function codeScroll(pre, id) {
            pre.dataset.codeScrollId = id;
            pre.addEventListener('scroll', () => handlers.codeScroll(id, { top: pre.scrollTop, left: pre.scrollLeft }));
        }
        function source(ref, parent) {
            const label = ref.availability === 'evidence-only' ? 'Evidence-only original reference' : code.sourceMode === 'current-source' ? 'Current source / verified original' : 'Captured source / verified original';
            parent.append(element('p', `${label}: ${ref.pathRef}`, 'evidence-location'));
            const pre = element('pre', ref.range.text ?? ref.text); pre.dataset.sourceReferenceId = ref.id;
            codeScroll(pre, ref.id);
            pre.dataset.sourceRevision = ref.revision; pre.dataset.rangeStart = String(ref.range.start); pre.dataset.rangeEnd = String(ref.range.end);
            pre.dataset.sourceRole = ref.availability === 'evidence-only' ? 'evidence-only' : code.sourceMode;
            parent.append(pre, element('p', `UTF-16 [${ref.range.start}, ${ref.range.end}); SHA256 ${ref.contentHash}; slice ${ref.sliceHash}`, 'evidence-location'));
            const b = button('Open approved source slice', () => handlers.openSource(ref), parent);
            b.dataset.sourceOpenId = ref.id; b.dataset.analysisSourceId = ref.id;
        }
        if (primaryRef) source(primaryRef, drawer);
        drawer.append(element('p', `${records.length} source records / ${Math.min(limit, records.length)} displayed; display limit is not query scope`, 'kind'));
        for (const record of records.slice(0, limit)) {
            const row = element('div', null, 'analysis-reference'); drawer.append(row);
            const b = button(`${record.role}${record.polarity === false ? ' / else (not)' : ''}: ${record.label}`, () => handlers.patchAnalysis({ codeSelection: record.id, codeOpen: true }), row);
            b.dataset.codeRecordId = record.id; b.dataset.sourceEntityId = record.entityId; b.dataset.analysisEntityId = record.entityId;
            b.setAttribute('aria-pressed', String(selection?.id === record.id));
        }
        if (records.length > limit) button(`Show next source records (${records.length - limit} retained)`, () => handlers.patchAnalysis({ codeLimit: limit + 32 }), drawer);
        if (selection) raw('selected-record', 'Local definitions / uses and canonical source record', selection.record, drawer);
        if (code.dependencies.length) raw('source-dependencies', 'Definition-use and binding environments', code.dependencies, drawer);
        if (saved.source) {
            const opened = element('section'); opened.dataset.codeSection = 'approved-source'; drawer.append(opened);
            if (saved.source.pending) opened.append(element('p', 'Opening approved source', 'kind'));
            if (saved.source.error) opened.append(element('p', saved.source.error, 'analysis-feedback error'));
            if (saved.source.result) {
                opened.append(element('p', `Approved read-only source; freshness: ${saved.source.result.freshness}`, 'kind'));
                const text = element('pre', saved.source.result.text); text.dataset.approvedSourceId = saved.source.result.id;
                codeScroll(text, `approved:${saved.source.result.id}`); opened.append(text);
            }
        }
        if (result.correspondence) {
            const s = group('correspondence', 'G3 mapping explanations');
            s.append(element('p', `Complete origin set: ${result.correspondence.completeOriginSetStatus}. Connectivity, contributors and source dependencies remain separate.`));
            for (const family of ['stock', 'origin']) {
                const mapping = result.correspondence[family];
                s.append(element('h3', family === 'stock' ? 'Stock correspondence' : 'Known contributors / partial origin'),
                    element('p', `${mapping.availability} / ${mapping.resolution}`));
                for (const explanation of mapping.explanations) {
                    const claim = explanation.claim, target = claim.target || claim.tuple?.target;
                    const d = raw(`claim:${claim.id}`, `${claim.relationKind || claim.status || family} / ${claim.scope || 'partial origin'}`, explanation, s);
                    d.dataset.claimId = claim.id;
                    const ref = target && { ...target, provider: family === 'origin' ? 'instrumented' : 'stock' };
                    if (BsvHardwareAnalysis.canReveal(ref)) {
                        const b = button(family === 'origin' ? 'Open partial contributor RTL' : 'Reveal verified connectivity', () => {
                            if (ref.provider !== scene.implementationContext.provider) return handlers.openImplementation();
                            return handlers.revealAnalysis(ref);
                        }, d); b.dataset.analysisRevealId = ref.entityId;
                    }
                    if (explanation.reader?.length) {
                        const generated = raw(`generated:${claim.id}`, 'Generated RTL / RTLIL reader evidence (hashes and locations; no file authority)', explanation.reader, d);
                        generated.dataset.sourceRole = 'generated';
                    }
                    if (explanation.evidence?.length) raw(`evidence:${claim.id}`, 'G3 evidence records / no file authority', explanation.evidence, d);
                }
            }
        }
        const refs = raw('source-references', `Original references (${result.sourceRefs.length})`, result.sourceRefs);
        for (const ref of result.sourceRefs) {
            const b = button(`${ref.sourceKind}: ${ref.pathRef} [${ref.range.start}, ${ref.range.end})`, () => handlers.openSource(ref), refs);
            b.dataset.sourceOpenId = ref.id; b.dataset.analysisSourceId = ref.id;
        }
        raw('full-source-result', 'Canonical source result / unresolved frontier', result);
        return section;
    }
    function updateAnalysisCounts(counts, target = document.getElementById('analysis-counts')) {
        if (target) target.textContent = `${counts.returned} returned refs / ${counts.visible} visible / ${counts.hidden} off-viewport / ${counts.offScene} off-scene / ${counts.frontier} frontier`;
    }
    root.BsvHardwareInspector = { render, updateAnalysisCounts };
    if (typeof module === 'object' && module.exports) module.exports = { textValue };
})(globalThis);
