import { useState } from 'react';
import { Alert } from 'react-native';
import axios from 'axios';
import { generarId } from '../utils/helpers';

export default function useMozo(ipServidor: string, appData: any) {
  const [mozo, setMozo] = useState({ vistaActual: 'mesas', mesaActiva: null as any, filtroCarta: '' });
  const [carrito, setCarrito] = useState<any[]>([]);
  const [cartVisible, setCartVisible] = useState(false);
  const [uiSplit, setUiSplit] = useState({ visible: false, idx: null as number | null, nextMod: '', cantidadTotal: 0, cantidadMover: 1 });
  
  const [ui, setUi] = useState({
    modalNota: false, notaInput: '', itemEditando: null as number | null, notaCantidadMover: 1,
    modalFueraCarta: false, fueraCartaItem: { id: '', nombre: '', precio: '' },
    modalDelivery: false, datosDelivery: { nombre: '', telefono: '', idx: null as number | null, mod: '' },
    modalBebidaDomingo: false, platoPendienteBebida: null as any,
    modalHistorialCambios: false
  });

  // 🟢 Calcular bebidas pendientes de asignar en modo domingo.
  // 🐛 FIX: solo cuentan los ALMUERZOS reales (es_modo_domingo + categoría
  // 'segundos'/'segundo'); un plato de carta no exige bebida.
  const getPendientesDomingo = (items: any[]) => {
    const totalAlmuerzos = items
      .filter(i => i.es_modo_domingo && ['segundos', 'segundo'].includes(String(i.categoria || '').toLowerCase().trim()))
      .reduce((sum, i) => sum + i.cantidad, 0);
    const totalBebidas = items.filter(i => i.isMenuDrink).reduce((sum, i) => sum + i.cantidad, 0);
    return totalAlmuerzos - totalBebidas;
  };

  const abrirMesa = (mesa: any) => {
    setMozo(prev => ({ ...prev, mesaActiva: mesa, filtroCarta: '', vistaActual: 'comandar' }));
    setCarrito([]);
  };

  const agregarAlCarrito = (plato: any, catNombre: string, bebidaSeleccionada: string | null = null) => {
    // 🟢 MODO DOMINGO: Ya no preguntamos bebida una por una, solo agregamos el almuerzo
    if (appData.modoDomingo && catNombre === 'segundos' && !bebidaSeleccionada) {
        // Simplemente agregamos el plato sin pedir bebida
        const cantEnCarrito = carrito.filter(i => i.nombre === plato.nombre && i.categoria === catNombre).reduce((acc, curr) => acc + curr.cantidad, 0);
        if (plato.stock_actual !== null && plato.stock_actual !== undefined && cantEnCarrito >= plato.stock_actual) {
            return Alert.alert('Stock Agotado', `Solo quedan ${plato.stock_actual} unidades.`);
        }
        setCarrito(prev => {
            const nuevoCarrito = [...prev];
            const indexPlato = nuevoCarrito.findIndex(i => i.nombre === plato.nombre && i.categoria === catNombre && i.modalidad === 'local' && (i.nota || '') === '');
            if (indexPlato > -1) {
                nuevoCarrito[indexPlato].cantidad += 1;
            } else {
                nuevoCarrito.push({
                    id: generarId(), nombre: plato.nombre, precio: plato.precio,
                    cantidad: 1, categoria: catNombre, modalidad: 'local', nota: '', cliente: null,
                    stock_actual: plato.stock_actual !== undefined ? plato.stock_actual : null,
                    taper: plato.taper || [],
                    costo_taper: plato.costo_taper || 0,
                    // 🐛 FIX: solo los almuerzos del menú (segundos) llevan es_modo_domingo
                    es_modo_domingo: appData.modoDomingo && ['segundos', 'segundo'].includes(catNombre.toLowerCase().trim())
                });
            }
            return nuevoCarrito;
        });
        return;
    }

    const cantEnCarrito = carrito.filter(i => i.nombre === plato.nombre && i.categoria === catNombre).reduce((acc, curr) => acc + curr.cantidad, 0);
    
    if (plato.stock_actual !== null && plato.stock_actual !== undefined && cantEnCarrito >= plato.stock_actual) {
        return Alert.alert('Stock Agotado', `Solo quedan ${plato.stock_actual} unidades.`);
    }

    setCarrito(prev => {
        const nuevoCarrito = [...prev];

        // 🟢 1. Agregamos el plato principal normal
        const indexPlato = nuevoCarrito.findIndex(i => i.nombre === plato.nombre && i.categoria === catNombre && i.modalidad === 'local' && (i.nota || '') === '');
        if (indexPlato > -1) { 
            nuevoCarrito[indexPlato].cantidad += 1; 
        } else {
            nuevoCarrito.push({
                id: generarId(), nombre: plato.nombre, precio: plato.precio,
                cantidad: 1, categoria: catNombre, modalidad: 'local', nota: '', cliente: null,
                stock_actual: plato.stock_actual !== undefined ? plato.stock_actual : null, 
                taper: plato.taper || [], 
                costo_taper: plato.costo_taper || 0,
                // 🐛 FIX: solo los almuerzos del menú (segundos) llevan es_modo_domingo
                es_modo_domingo: appData.modoDomingo && ['segundos', 'segundo'].includes(catNombre.toLowerCase().trim())
            });
        }

        // 🟢 2. Agregamos la bebida como "Ítem Fantasma" (S/ 0)
        if (bebidaSeleccionada) {
            const idxBebida = nuevoCarrito.findIndex(i => i.nombre === bebidaSeleccionada && i.isMenuDrink === true && i.modalidad === 'local');
            if (idxBebida > -1) {
                nuevoCarrito[idxBebida].cantidad += 1;
            } else {
                nuevoCarrito.push({
                    id: generarId(), nombre: bebidaSeleccionada, precio: 0,
                    cantidad: 1, categoria: 'BEBIDAS', modalidad: 'local', nota: '', cliente: null,
                    stock_actual: null, taper: [], costo_taper: 0,
                    isMenuDrink: true // 🚩 ESTO ES CLAVE PARA OCULTARLA EN EL TICKET DE CLIENTE
                });
            }
        }

        return nuevoCarrito;
    });

    setUi(prev => ({ ...prev, modalBebidaDomingo: false }));
  };

  /** 🟢 Asigna UNA bebida a los almuerzos pendientes.
   *  El contador de pendientes se calcula dinámicamente: totalAlmuerzos - totalBebidas.
   *  Ya no depende de la bandera necesitaBebida.
   */
  const asignarBebidasAlmuerzos = (bebida: string) => {
    setCarrito(prev => {
        const pendientes = getPendientesDomingo(prev);
        if (pendientes <= 0) return prev;
        
        const nuevoCarrito = [...prev];
        const idxBebida = nuevoCarrito.findIndex(i => i.nombre === bebida && i.isMenuDrink === true && i.modalidad === 'local');
        if (idxBebida > -1) {
            nuevoCarrito[idxBebida].cantidad += 1;
        } else {
            nuevoCarrito.push({
                id: generarId(), nombre: bebida, precio: 0,
                cantidad: 1, categoria: 'BEBIDAS', modalidad: 'local', nota: '', cliente: null,
                stock_actual: null, taper: [], costo_taper: 0,
                isMenuDrink: true
            });
        }
        return nuevoCarrito;
    });
    // No cerramos el modal — el usuario sigue asignando hasta terminar
  };

  // 🟢 Quitar UNA bebida ya asignada (NO necesita marcar ningún almuerzo como pendiente,
  //     el contador se recalcula dinámicamente)
  const removerBebidaAsignada = (nombreBebida: string) => {
    setCarrito(prev => {
      const n = [...prev];
      const idxBeb = n.findIndex(i => i.nombre === nombreBebida && i.isMenuDrink === true);
      if (idxBeb === -1) return prev;

      const bebida = n[idxBeb];
      if (bebida.cantidad <= 1) {
        n.splice(idxBeb, 1);
      } else {
        n[idxBeb] = { ...bebida, cantidad: bebida.cantidad - 1 };
      }
      return n;
    });
  };

  const modificarCantidad = (index: number, cambio: number) => {
    setCarrito(prev => {
      const n = [...prev];
      const item = n[index];

      if (cambio > 0 && item.stock_actual !== null) {
         const cantTotalEnCarrito = n.filter(i => i.nombre === item.nombre).reduce((acc, curr) => acc + curr.cantidad, 0);
         if (cantTotalEnCarrito >= item.stock_actual) {
            Alert.alert('Stock Agotado', `Límite alcanzado. Solo quedan ${item.stock_actual} raciones.`);
            return prev; 
         }
      }

      n[index] = { ...item, cantidad: item.cantidad + cambio };
      if (n[index].cantidad <= 0) n.splice(index, 1);
      return n;
    });
  };

  const calcularRecargoTaperMozo = (item: any) => {
      if (!item.modalidad || item.modalidad === 'local') return 0;
      const cat = item.categoria ? item.categoria.toUpperCase().trim() : '';
      const nom = item.nombre ? item.nombre.toUpperCase().trim() : '';

      // 🟢 La bebida/refresco del día nunca lleva recargo adicional
      if (nom.includes('REFRESCO')) return 0;
      // 🟢 GUARNICIONES, JUGOS, BEBIDAS HELADAS/CALIENTES, CERVEZA: siempre +1 sol (no importa el taper)
      if (['GUARNICIONES', 'JUGOS NATURALES', 'BEBIDAS HELADAS', 'BEBIDAS CALIENTES', 'CERVEZA', 'BEBIDAS'].includes(cat)) return 1;

      // 🟢 Delivery y delivery_centro tienen tarifa plana (3 y 4 soles respectivamente)
      // Los tapers se descuentan del inventario pero NO afectan el precio directo
      // 🟢 Humita no lleva recargo fijo de delivery (S/4 local, S/5 llevar/delivery)
      // 🟢 NUEVOS PRECIOS (desde Julio 20): menu S/16, delivery S/19, delivery_centro S/20
      if (item.modalidad === 'delivery' && !nom.includes('HUMITA')) return 3;
      if (item.modalidad === 'delivery_centro' && !nom.includes('HUMITA')) return 4;

      // Para llevar: calcular costo de taper/envase
      let recargoEnvase = item.costo_taper || 0;
      if (!item.costo_taper && item.taper) {
          const tArr = Array.isArray(item.taper) ? item.taper : [item.taper];
          tArr.forEach((t: string) => {
              if (t === 'chico' || t === 'sopa') recargoEnvase += 1;
              if (t === 'mediano' || t === 'grande') recargoEnvase += 2;
          });
      } else if (!item.costo_taper && (!item.taper || item.taper.length === 0)) {
          if (nom.includes('(ENTRADA)') || nom.includes('HUMITA') || nom.includes('ARROZ') || nom.includes('CAMOTE') || nom.includes('YUCA')) recargoEnvase += 1;
      }

      return recargoEnvase;
  };

  const ciclarModalidad = (index: number) => {
    if (carrito[index].nombre.toUpperCase().startsWith('TAPER ')) return;
    // 🟢 FIX: La carta ya no tiene delivery_centro
    // En modo domingo tampoco hay delivery_centro para ningún plato
    const catItem = (carrito[index].categoria || '').toLowerCase().trim();
    const esMenuDiario = ['entradas', 'entrada', 'segundos', 'segundo'].includes(catItem);
    const ordenBase = ['local', 'llevar', 'delivery', 'delivery_centro'];
    const orden = (esMenuDiario && !appData.modoDomingo) ? ordenBase : ordenBase.filter(m => m !== 'delivery_centro');
    const modActual = carrito[index].modalidad;
    const nextMod = orden[(orden.indexOf(modActual) + 1) % orden.length];

    if (carrito[index].cantidad > 1) {
       setUiSplit({ visible: true, idx: index, nextMod, cantidadTotal: carrito[index].cantidad, cantidadMover: 1 });
       return;
    }

    if ((nextMod === 'delivery' || nextMod === 'delivery_centro') && (modActual !== 'delivery' && modActual !== 'delivery_centro')) {
      setUi(prev => ({ ...prev, datosDelivery: { nombre: carrito[index].cliente?.nombre || '', telefono: carrito[index].cliente?.telefono || '', idx: index, mod: nextMod }, modalDelivery: true }));
    } else {
      setCarrito(prev => {
        const n = [...prev];
        const clienteActual = n[index].cliente;
        n[index] = { ...n[index], modalidad: nextMod, cliente: (nextMod === 'delivery' || nextMod === 'delivery_centro') ? clienteActual : null };
        return n;
      });
    }
  };

  const confirmarSplit = () => {
    const { idx, nextMod, cantidadTotal, cantidadMover } = uiSplit;
    if (idx === null) return;
    const modActual = carrito[idx].modalidad;
    let targetIdx = idx;
    let needDeliveryModal = false;

    setCarrito(prev => {
      const n = [...prev];
      const itemOriginal = { ...n[idx] };
      const matchIdx = n.findIndex((it, i) => i !== idx && it.nombre === itemOriginal.nombre && it.categoria === itemOriginal.categoria && it.modalidad === nextMod && it.nota === itemOriginal.nota);

      if (cantidadMover === cantidadTotal) {
        if (matchIdx > -1) {
          n[matchIdx].cantidad += cantidadMover;
          targetIdx = matchIdx;
          n.splice(idx, 1);
        } else {
          n[idx].modalidad = nextMod;
          if (nextMod !== 'delivery' && nextMod !== 'delivery_centro') n[idx].cliente = null;
        }
      } else {
        n[idx].cantidad -= cantidadMover;
        if (matchIdx > -1) {
          n[matchIdx].cantidad += cantidadMover;
          targetIdx = matchIdx;
        } else {
          const newItem = { ...itemOriginal, id: generarId(), cantidad: cantidadMover, modalidad: nextMod };
          if (nextMod !== 'delivery' && nextMod !== 'delivery_centro') newItem.cliente = null;
          n.splice(idx + 1, 0, newItem);
          targetIdx = idx + 1;
        }
      }

      if ((nextMod === 'delivery' || nextMod === 'delivery_centro') && (modActual !== 'delivery' && modActual !== 'delivery_centro')) needDeliveryModal = true;
      return n;
    });

    if (needDeliveryModal) {
        setTimeout(() => setUi(u => ({ ...u, datosDelivery: { nombre: '', telefono: '', idx: targetIdx, mod: nextMod }, modalDelivery: true })), 50);
    }
    setUiSplit({ visible: false, idx: null, nextMod: '', cantidadTotal: 0, cantidadMover: 1 });
  };

  const confirmarDatosDelivery = () => {
    if (!ui.datosDelivery.nombre) return Alert.alert('Faltan datos', 'El nombre es obligatorio.');
    setCarrito(prev => {
      const n = [...prev];
      if (ui.datosDelivery.idx !== null) {
        n[ui.datosDelivery.idx] = { 
          ...n[ui.datosDelivery.idx], modalidad: ui.datosDelivery.mod,
          cliente: { nombre: ui.datosDelivery.nombre, direccion: '', telefono: ui.datosDelivery.telefono }
        };
      }
      return n;
    });
    setUi(prev => ({ ...prev, modalDelivery: false }));
  };

  const guardarPlatoFueraCarta = () => {
    const p = parseFloat(ui.fueraCartaItem.precio);
    if (!ui.fueraCartaItem.nombre || isNaN(p)) return Alert.alert('Error', 'Ingrese nombre y precio válido.');
    setCarrito(prev => [...prev, { 
      id: generarId(), nombre: `${ui.fueraCartaItem.nombre} (Extra)`, 
      precio: p, cantidad: 1, categoria: 'GENERAL', modalidad: 'local', nota: '' 
    }]);
    setUi(prev => ({ ...prev, fueraCartaItem: { id: '', nombre: '', precio: '' }, modalFueraCarta: false }));
  };

  const guardarNota = () => {
    if (ui.itemEditando !== null) {
      const idx = ui.itemEditando;
      const textoNota = ui.notaInput.toUpperCase().trim();
      const cantidadMover = ui.notaCantidadMover;
      
      setCarrito(prev => {
        const n = [...prev];
        const itemOriginal = n[idx];
        const cantidadTotal = itemOriginal.cantidad;

        if (cantidadMover === cantidadTotal) n[idx] = { ...itemOriginal, nota: textoNota };
        else {
          n[idx] = { ...itemOriginal, cantidad: cantidadTotal - cantidadMover };
          const newItem = { ...itemOriginal, id: generarId(), cantidad: cantidadMover, nota: textoNota };
          n.splice(idx + 1, 0, newItem);
        }

        const agrupado: any[] = [];
        n.forEach(it => {
          const idxMatch = agrupado.findIndex(f => f.nombre === it.nombre && f.modalidad === it.modalidad && (f.nota || '') === (it.nota || ''));
          if (idxMatch > -1) agrupado[idxMatch].cantidad += it.cantidad;
          else agrupado.push(it);
        });
        return agrupado;
      });
    }
    setUi(prev => ({ ...prev, modalNota: false }));
  };

  const enviarComanda = async () => {
    if (carrito.length === 0) return Alert.alert('Aviso', 'El carrito está vacío.');

    // 🟢 Verificar si hay almuerzos que necesitan bebida (modo domingo)
    //    El conteo es dinámico: total almuerzos - total bebidas isMenuDrink
    const cantAlmuerzosPendientes = getPendientesDomingo(carrito);
    
    if (cantAlmuerzosPendientes > 0) {
        // Mostrar modal para seleccionar bebidas en bulk
        setUi(prev => ({ ...prev, modalBebidaDomingo: true }));
        return;
    }

    // Validación de Bebidas para Almuerzos (legacy)
    const cantAlmuerzos = carrito.filter(i => i.nombre.startsWith('ALMUERZO')).reduce((sum, i) => sum + i.cantidad, 0);
    const cantBebidas = carrito.filter(i => i.precio === 0 && ['INKA COLA 296ML', 'COCA COLA 296ML', 'REFRESCO DEL DÍA', 'REFRESCO DEL DIA'].includes(i.nombre)).reduce((sum, i) => sum + i.cantidad, 0);

    if (cantAlmuerzos > cantBebidas) {
        return Alert.alert('Faltan Bebidas', `Has comandado ${cantAlmuerzos} almuerzos pero solo elegiste ${cantBebidas} bebidas gratis.`);
    }

    try {
      await axios.post(`http://${ipServidor}:3001/api/pedidos`, { 
        mesa: mozo.mesaActiva.id, items: carrito, nota_general: mozo.mesaActiva.nota_general || '' 
      });
      setCarrito([]);
      setMozo(prev => ({ ...prev, vistaActual: 'mesas', mesaActiva: null }));
      Alert.alert('Éxito', 'Comanda enviada a cocina.');
    } catch (error: any) {
      const msg = error.response?.data?.error || 'No se pudo enviar la comanda. Revisa la conexión con la Caja.';
      Alert.alert('Operación Bloqueada', msg);
    }
  };

  const totalItems = carrito.reduce((s, i) => s + i.cantidad, 0);

  return {
    mozo, setMozo, carrito, setCarrito, cartVisible, setCartVisible, uiSplit, setUiSplit, ui, setUi, totalItems,
    abrirMesa, agregarAlCarrito, modificarCantidad, calcularRecargoTaperMozo, ciclarModalidad, confirmarSplit,
    confirmarDatosDelivery, guardarPlatoFueraCarta,    guardarNota, enviarComanda, asignarBebidasAlmuerzos, removerBebidaAsignada
  };
}