import React from 'react';
import { create, act } from 'react-test-renderer';
import useMozo from '../hooks/useMozo';

jest.mock('axios');
jest.mock('react-native', () => ({
  Alert: { alert: jest.fn() },
  Platform: { OS: 'ios' },
}));
jest.mock('../utils/helpers', () => ({
  generarId: jest.fn(() => 'abc12345'),
}));


const mockAppData = {
  modoDomingo: false,
  mesas: [{ id: 'mesa_1', pedido: [], total: 0 }],
  carta: [{ nombre: 'Entradas', items: [{ nombre: 'Ceviche', precio: 8, stock_actual: null }] }],
};

function renderHook<T>(hookFn: () => T) {
  const result = { current: null as any };
  function TestComponent() {
    result.current = hookFn();
    return null;
  }
  act(() => {
    create(React.createElement(TestComponent));
  });
  return { result };
}

describe('useMozo', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('estado inicial', () => {
    test('valores por defecto', () => {
      const { result } = renderHook(() => useMozo('192.168.1.100', mockAppData));
      expect(result.current.mozo.vistaActual).toBe('mesas');
      expect(result.current.mozo.mesaActiva).toBeNull();
      expect(result.current.mozo.filtroCarta).toBe('');
      expect(result.current.carrito).toEqual([]);
      expect(result.current.totalItems).toBe(0);
    });
  });

  describe('calcularRecargoTaperMozo (función pura)', () => {
    test('local sin recargo', () => {
      const { result } = renderHook(() => useMozo('192.168.1.100', mockAppData));
      expect(result.current.calcularRecargoTaperMozo({ modalidad: 'local' })).toBe(0);
    });

    test('sin modalidad no tiene recargo', () => {
      const { result } = renderHook(() => useMozo('192.168.1.100', mockAppData));
      expect(result.current.calcularRecargoTaperMozo({})).toBe(0);
    });

    test('delivery S/3', () => {
      const { result } = renderHook(() => useMozo('192.168.1.100', mockAppData));
      expect(
        result.current.calcularRecargoTaperMozo({
          modalidad: 'delivery', categoria: 'Segundos', nombre: 'Arroz',
        }),
      ).toBe(3);
    });

    test('delivery_centro S/4', () => {
      const { result } = renderHook(() => useMozo('192.168.1.100', mockAppData));
      expect(
        result.current.calcularRecargoTaperMozo({
          modalidad: 'delivery_centro', categoria: 'Segundos', nombre: 'Arroz',
        }),
      ).toBe(4);
    });

    test('llevar con taper mediano S/2', () => {
      const { result } = renderHook(() => useMozo('192.168.1.100', mockAppData));
      expect(
        result.current.calcularRecargoTaperMozo({
          modalidad: 'llevar', categoria: 'Segundos', nombre: 'Arroz', taper: ['mediano'],
        }),
      ).toBe(2);
    });

    test('bebidas siempre S/1 en cualquier modalidad', () => {
      const { result } = renderHook(() => useMozo('192.168.1.100', mockAppData));
      expect(
        result.current.calcularRecargoTaperMozo({ modalidad: 'llevar', categoria: 'BEBIDAS', nombre: 'Inka Cola' }),
      ).toBe(1);
      expect(
        result.current.calcularRecargoTaperMozo({ modalidad: 'delivery', categoria: 'CERVEZA', nombre: 'Cusqueña' }),
      ).toBe(1);
    });

    test('refresco del dia nunca tiene recargo', () => {
      const { result } = renderHook(() => useMozo('192.168.1.100', mockAppData));
      expect(
        result.current.calcularRecargoTaperMozo({ modalidad: 'llevar', categoria: 'BEBIDAS', nombre: 'REFRESCO DEL DÍA' }),
      ).toBe(0);
    });

    test('humita delivery no tiene recargo de delivery (S/3), solo envase (S/1)', () => {
      const { result } = renderHook(() => useMozo('192.168.1.100', mockAppData));
      // HUMITA no paga delivery surcharge (los S/3 se saltan), pero sí envase
      expect(
        result.current.calcularRecargoTaperMozo({ modalidad: 'delivery', nombre: 'HUMITA' }),
      ).toBe(1);
    });
  });

  describe('ciclarModalidad', () => {
    test('cicla modalidad de local a llevar (cantidad=1)', () => {
      const { result } = renderHook(() => useMozo('192.168.1.100', mockAppData));

      act(() => {
        result.current.agregarAlCarrito(
          { nombre: 'ARROZ CON POLLO', precio: 16, stock_actual: null },
          'Segundos',
        );
      });

      expect(result.current.carrito.length).toBe(1);
      expect(result.current.carrito[0].modalidad).toBe('local');
      expect(result.current.carrito[0].cantidad).toBe(1);

      act(() => {
        result.current.ciclarModalidad(0);
      });

      expect(result.current.carrito[0].modalidad).toBe('llevar');
      expect(result.current.uiSplit.visible).toBe(false);
    });

    test('ciclarModalidad con cantidad > 1 abre split UI en vez de cambiar directo', () => {
      const { result } = renderHook(() => useMozo('192.168.1.100', mockAppData));

      act(() => {
        result.current.agregarAlCarrito(
          { nombre: 'ARROZ CON POLLO', precio: 16, stock_actual: null },
          'Segundos',
        );
      });
      act(() => {
        result.current.agregarAlCarrito(
          { nombre: 'ARROZ CON POLLO', precio: 16, stock_actual: null },
          'Segundos',
        );
      });

      expect(result.current.carrito.length).toBe(1);
      expect(result.current.carrito[0].cantidad).toBe(2);

      act(() => {
        result.current.ciclarModalidad(0);
      });

      expect(result.current.uiSplit.visible).toBe(true);
      expect(result.current.uiSplit.idx).toBe(0);
      expect(result.current.uiSplit.nextMod).toBe('llevar');
      expect(result.current.uiSplit.cantidadTotal).toBe(2);
      expect(result.current.uiSplit.cantidadMover).toBe(1);
    });

    test('ignora items que empiezan con TAPER', () => {
      const { result } = renderHook(() => useMozo('192.168.1.100', mockAppData));

      act(() => {
        result.current.setCarrito([
          {
            id: 'tap123', nombre: 'TAPER CHICO', precio: 2, cantidad: 1,
            categoria: 'GENERAL', modalidad: 'local', nota: '',
          },
        ]);
      });

      act(() => {
        result.current.ciclarModalidad(0);
      });

      expect(result.current.carrito[0].modalidad).toBe('local');
    });
  });

  describe('confirmarSplit', () => {
    test('split con modalidad diferente (cantidadMover < cantidadTotal) crea nuevo item con nueva modalidad', () => {
      const { result } = renderHook(() => useMozo('192.168.1.100', mockAppData));

      act(() => {
        result.current.agregarAlCarrito(
          { nombre: 'ARROZ CON POLLO', precio: 16, stock_actual: null },
          'Segundos',
        );
      });
      act(() => {
        result.current.agregarAlCarrito(
          { nombre: 'ARROZ CON POLLO', precio: 16, stock_actual: null },
          'Segundos',
        );
      });

      expect(result.current.carrito.length).toBe(1);
      expect(result.current.carrito[0].cantidad).toBe(2);
      expect(result.current.carrito[0].modalidad).toBe('local');

      // trigger split UI
      act(() => {
        result.current.ciclarModalidad(0);
      });
      expect(result.current.uiSplit.visible).toBe(true);

      // confirm split
      act(() => {
        result.current.confirmarSplit();
      });

      // original item conserva cantidad reducida y misma modalidad
      expect(result.current.carrito[0].cantidad).toBe(1);
      expect(result.current.carrito[0].modalidad).toBe('local');

      // nuevo item tiene cantidad movida y nueva modalidad
      expect(result.current.carrito[1].cantidad).toBe(1);
      expect(result.current.carrito[1].modalidad).toBe('llevar');

      // uiSplit reseteado
      expect(result.current.uiSplit.visible).toBe(false);
    });

    test('split moviendo todo (cantidadMover === cantidadTotal) cambia modalidad del unico item', () => {
      const { result } = renderHook(() => useMozo('192.168.1.100', mockAppData));

      act(() => {
        result.current.setCarrito([
          {
            id: 'item1', nombre: 'CEVICHE', precio: 12, cantidad: 2,
            categoria: 'entradas', modalidad: 'local', nota: '', cliente: null,
            stock_actual: null, taper: [], costo_taper: 0,
          },
        ]);
      });

      // set uiSplit para mover todo
      act(() => {
        result.current.setUiSplit({
          visible: true, idx: 0, nextMod: 'llevar',
          cantidadTotal: 2, cantidadMover: 2,
        });
      });

      act(() => {
        result.current.confirmarSplit();
      });

      // solo 1 item, modalidad cambiada
      expect(result.current.carrito.length).toBe(1);
      expect(result.current.carrito[0].cantidad).toBe(2);
      expect(result.current.carrito[0].modalidad).toBe('llevar');
    });

    test('split con idx null (uiSplit no activo) no modifica carrito', () => {
      const { result } = renderHook(() => useMozo('192.168.1.100', mockAppData));

      act(() => {
        result.current.agregarAlCarrito(
          { nombre: 'ARROZ CON POLLO', precio: 16, stock_actual: null },
          'Segundos',
        );
      });

      const carritoSnapshot = JSON.parse(JSON.stringify(result.current.carrito));

      // idx es null por defecto
      act(() => {
        result.current.confirmarSplit();
      });

      expect(result.current.carrito).toEqual(carritoSnapshot);
      expect(result.current.carrito.length).toBe(1);
      expect(result.current.carrito[0].cantidad).toBe(1);
    });
  });
});
